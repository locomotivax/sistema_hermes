"""Reproducible, local ETL. Public output contains aggregates only."""
from __future__ import annotations
import argparse, hashlib, json, math, re, zipfile, datetime as dt, shutil
from pathlib import Path
import xml.etree.ElementTree as ET
import duckdb, geopandas as gpd, numpy as np, pandas as pd, pyarrow as pa, pyarrow.parquet as pq
import osmium, osmnx as ox, networkx as nx, requests
from dbfread import DBF
from pyproj import Transformer
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra
from scipy.spatial import cKDTree
from shapely.geometry import Point, LineString

ROOT=Path(__file__).resolve().parents[1]; RAW=ROOT/'data/raw'; OUT=ROOT/'data/processed'
MODES=['car','moto','bus','bike','walk','other']
URLS={
 'od2023.zip':'https://transparencia.metrosp.com.br/sites/default/files/Site_190225_PesquisaOD2023.zip',
 'census-sp.zip':'https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_de_setores_censitarios__divisoes_intramunicipais/censo_2022/setores/shp/UF/SP_setores_CD2022.zip',
 'census.csv':'https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022/Agregados_por_Setores_Censitarios/malha_com_atributos/setores/csv/BR_setores_CD2022.csv',
 'census-dictionary.xlsx':'https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022/Agregados_por_Setores_Censitarios/malha_com_atributos/Dicionario_de_dados_malha_agregados.xlsx',
 'his.geojson':'https://wfs.geosampa.prefeitura.sp.gov.br/geoserver/geoportal/wfs?service=WFS&version=1.0.0&request=GetFeature&typeName=geoportal:habitacao_popular&outputFormat=application%2Fjson&srsName=EPSG%3A4326',
 'pde.gpkg':'https://monitoramentopde.gestaourbana.prefeitura.sp.gov.br/app/uploads/msp_alvaras_sisacoe_aprovadigital/20250422_20250416_msp_alvaras_sisacoe_aprovadigital.gpkg',
 'sudeste.osm.pbf':'https://download.geofabrik.de/south-america/brazil/sudeste-latest.osm.pbf',
 'intersection.osm':'https://api.openstreetmap.org/api/0.6/map?bbox=-46.753,-23.57,-46.74,-23.556',
}
REFERENCE='2026-10-03'; VERSION='1.0.0'; WGS_TO_METRES=Transformer.from_crs(4326,31983,always_xy=True)

def dump(path,value):
 path.parent.mkdir(parents=True,exist_ok=True)
 path.write_text(json.dumps(value,ensure_ascii=False,allow_nan=False,separators=(',',':')),encoding='utf8')
def digest(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
 return h.hexdigest()
def download():
 RAW.mkdir(parents=True,exist_ok=True)
 for filename,url in URLS.items():
  target=RAW/filename
  if target.exists():continue
  print('Downloading',filename,flush=True)
  with requests.get(url,stream=True,timeout=(30,180)) as r:
   r.raise_for_status()
   with target.with_suffix(target.suffix+'.part').open('wb') as f:
    for block in r.iter_content(1024*1024):f.write(block)
  target.with_suffix(target.suffix+'.part').replace(target)
def extract():
 for archive,folder in [('od2023.zip','od2023'),('census-sp.zip','census-sp')]:
  if not (RAW/folder).exists():
   with zipfile.ZipFile(RAW/archive) as z:
    for member in z.namelist():
     if not (RAW/folder/member).resolve().is_relative_to((RAW/folder).resolve()):raise ValueError('Unsafe archive path')
    z.extractall(RAW/folder)
def intersection():
 r=ET.parse(RAW/'intersection.osm').getroot()
 nodes={int(n.attrib['id']):(float(n.attrib['lon']),float(n.attrib['lat'])) for n in r.findall('node')}
 a=set();b=set()
 for w in r.findall('way'):
  tags={t.attrib['k']:t.attrib['v'] for t in w.findall('tag')};name=tags.get('name','');refs={int(n.attrib['ref']) for n in w.findall('nd')}
  if 'Corifeu' in name:a|=refs
  if 'Rio Pequeno' in name:b|=refs
 ids=a&b
 if not ids:raise ValueError('Intersection not found in OSM, no coordinate fallback allowed')
 center=np.mean([nodes[n] for n in ids],axis=0).tolist()
 return center,ids

def od_frame():
 target=OUT/'od.parquet';base=RAW/'od2023/Site_190225'
 if target.exists() and 'AUTO_DECL' not in pq.read_schema(target).names:target.unlink()
 if not target.exists():
  columns=['ZONA','MUNI_DOM','F_DOM','FE_DOM','F_FAM','FE_FAM','F_PESS','FE_PESS','NO_MORAD','QT_AUTO','QT_MOTO','RENDA_FA','N_VIAG','FE_VIA','MODOPRIN','MOTIVO','ZONA_O','ZONA_D','H_SAIDA','CO_DOM_X','CO_DOM_Y','CO_O_X','CO_O_Y','CO_D_X','CO_D_Y']
  batch=[];writer=None
  for row in DBF(base/'Banco2023_divulgacao_190225.dbf',encoding='latin1'):
   record={k:float(row[k] or 0) for k in columns};record['AUTO_DECL']=0.0 if row['NAO_DCL_IT']=='S' else 1.0;batch.append(record)
   if len(batch)>=10000:
    table=pa.Table.from_pylist(batch)
    if writer is None:writer=pq.ParquetWriter(target,table.schema)
    writer.write_table(table);batch=[]
  if batch:
   table=pa.Table.from_pylist(batch)
   if writer is None:writer=pq.ParquetWriter(target,table.schema)
   writer.write_table(table)
  if writer:writer.close()
 db=duckdb.connect();db.execute("SET memory_limit='1GB'");db.execute(f"SET temp_directory='{OUT}/duck-tmp'")
 frame=db.sql(f"SELECT * FROM read_parquet('{target}')").df();db.close()
 return frame
def table_one():
 t=pd.read_excel(RAW/'od2023/Site_190225/Tabelas_Site_OD2023_REV_190225.xlsx',sheet_name='Tab1',header=None)
 t=t[pd.to_numeric(t[0],errors='coerce').between(1,527)].copy()
 t.columns=['id','name','households','families','population','students','jobs','cars','produced','attracted','area']
 t['id']=t.id.astype(int)
 for column in ['households','families','population','students','jobs','cars','produced','attracted','area']:t[column]=pd.to_numeric(t[column],errors='coerce')
 return t.set_index('id')
def classify(frame):
 return np.select([frame.MODOPRIN.isin([9,10]),frame.MODOPRIN.isin([13,14]),frame.MODOPRIN.isin([4,5,6]),frame.MODOPRIN.eq(16),frame.MODOPRIN.eq(17)],MODES[:5],default='other')

class Roads(osmium.SimpleHandler):
 def __init__(self,bounds):
  super().__init__();self.bounds=bounds;self.nodes={};self.ways=[];self.stops=[];self.restrictions=0
 def node(self,n):
  x,y=n.location.lon,n.location.lat;l,b,r,t=self.bounds
  if l<=x<=r and b<=y<=t:
   self.nodes[n.id]=(x,y)
   if n.tags.get('highway')=='bus_stop' or n.tags.get('public_transport') in ['station','stop_position'] or n.tags.get('railway')=='station':self.stops.append((x,y))
 def way(self,w):
  road=w.tags.get('highway')
  if not road or w.tags.get('access') in ['private','no']:return
  refs=[n.ref for n in w.nodes]
  if any(n in self.nodes for n in refs):self.ways.append((w.id,dict(w.tags),refs))
 def relation(self,r):
  if r.tags.get('type')=='restriction':self.restrictions+=1

def network(zones,center):
 path=OUT/'network.json'
 if path.exists():return json.loads(path.read_text())
 bounds=zones.to_crs(4326).total_bounds.copy();bounds[:2]-=.02;bounds[2:]+=.02
 h=Roads(bounds);print('Reading OSM regional extract',flush=True);h.apply_file(RAW/'sudeste.osm.pbf')
 drive_classes={'motorway','motorway_link','trunk','trunk_link','primary','primary_link','secondary','secondary_link','tertiary','tertiary_link','residential','unclassified','living_street','service'}
 speeds={'motorway':90,'trunk':70,'primary':50,'secondary':40,'tertiary':30,'residential':25,'unclassified':25,'service':15,'living_street':10}
 nodes={};edges=[];roads=[];cx,cy=WGS_TO_METRES.transform(*center)
 for way_id,tags,refs in h.ways:
  hw=tags['highway'];drive=hw in drive_classes and tags.get('motor_vehicle')!='no'
  bike=(hw in drive_classes-{'motorway','motorway_link','trunk','trunk_link'} or hw=='cycleway' or tags.get('bicycle') in ['yes','designated']) and tags.get('bicycle')!='no'
  if not drive and not bike:continue
  speed=float(re.findall(r'\d+',tags.get('maxspeed',''))[0]) if re.findall(r'\d+',tags.get('maxspeed','')) else speeds.get(hw.replace('_link',''),25)
  speed=max(5,min(speed,130));oneway=tags.get('oneway','') in ['yes','1','true'] or tags.get('junction')=='roundabout';reverse=tags.get('oneway')=='-1'
  for u,v in zip(refs,refs[1:]):
   if u not in h.nodes or v not in h.nodes:continue
   for n in [u,v]:nodes[str(n)]=h.nodes[n]
   line=LineString([h.nodes[u],h.nodes[v]]);a=WGS_TO_METRES.transform(*h.nodes[u]);b=WGS_TO_METRES.transform(*h.nodes[v]);length=math.dist(a,b)
   if length<.01:continue
   if reverse:u,v=v,u
   name=tags.get('name','');arterial=hw in ['primary','secondary','trunk','motorway']
   edges.append([u,v,length,speed,int(drive),int(bike),int(arterial),name])
   if not oneway and not reverse:edges.append([v,u,length,speed,int(drive),int(bike),int(arterial),name])
   elif bike and tags.get('oneway:bicycle')=='no':edges.append([v,u,length,speed,0,1,int(arterial),name])
  coords=[h.nodes[n] for n in refs if n in h.nodes]
  if len(coords)>1 and min(math.dist(WGS_TO_METRES.transform(*c),(cx,cy)) for c in coords)<2400:
   roads.append({'type':'Feature','geometry':{'type':'LineString','coordinates':coords},'properties':{'id':way_id,'name':tags.get('name',''),'highway':hw}})
 data={'nodes':nodes,'edges':edges,'stops':h.stops,'roads':roads,'restrictionRelations':h.restrictions}
 dump(path,data);print('Network:',len(nodes),'nodes;',len(edges),'directed edges',flush=True);return data

def prepare_graph(data,bike=False,variant=1):
 cache=OUT/('bike-graph.json' if bike else 'motor-graph.json')
 if cache.exists():
  saved=json.loads(cache.read_text());ids=saved['ids'];index={n:i for i,n in enumerate(ids)};coords=np.array(saved['coords']);xy=np.column_stack(WGS_TO_METRES.transform(coords[:,0],coords[:,1]));tree=cKDTree(xy)
  edges=saved['edges'];matrix=csr_matrix(([e[2]/(variant if not bike and e[3] else 1) for e in edges],([e[0] for e in edges],[e[1] for e in edges])),shape=(len(ids),len(ids)));names={(e[0],e[1]):e[4] for e in edges}
  return matrix,index,coords,tree,names,xy
 center=np.array(WGS_TO_METRES.transform(-46.74664555,-23.56276395))
 # Preserve local streets; use regional arterials outside 12 km. This is explicitly
 # recorded as a connector approximation, not a complete freight/transit model.
 original_ids=sorted({e[i] for e in data['edges'] for i in [0,1]});original_coords=np.array([data['nodes'][str(n)] for n in original_ids]);original_xy=np.column_stack(WGS_TO_METRES.transform(original_coords[:,0],original_coords[:,1]));near={n for n,inside in zip(original_ids,np.linalg.norm(original_xy-center,axis=1)<12000) if inside}
 rows=[e for e in data['edges'] if e[5 if bike else 4] and (e[0] in near or e[1] in near or e[6] or e[3]>=40)]
 g=nx.MultiDiGraph(crs='EPSG:4326')
 for e in rows:
  for n in [e[0],e[1]]:
   if n not in g:
    x,y=data['nodes'][str(n)];attrs={'x':x,'y':y}
    if math.dist(WGS_TO_METRES.transform(x,y),center)<100:attrs['study_intersection']=True
    g.add_node(n,**attrs)
  speed=15 if bike else e[3]*(variant if e[6] else 1)
  g.add_edge(e[0],e[1],length=e[2],travel_time=e[2]/(speed/3.6),name=e[7],speed=e[3],arterial=e[6])
 g=ox.simplification.simplify_graph(g,node_attrs_include=['study_intersection'],edge_attrs_differ=['speed','arterial','name'])
 ids=sorted(g.nodes);index={n:i for i,n in enumerate(ids)}
 coords=np.array([data['nodes'][str(n)] for n in ids]);xy=np.column_stack(WGS_TO_METRES.transform(coords[:,0],coords[:,1]));tree=cKDTree(xy)
 # Explicit min handles parallel ways; CSR constructor otherwise sums their weights.
 costs={};names={}
 for u,v,e in g.edges(data=True):
  key=(index[u],index[v]);cost=e['travel_time']
  if key not in costs or cost<costs[key]:costs[key]=cost;names[key]=e['name'] if isinstance(e['name'],str) else e['name'][0]
 keys=list(costs);matrix=csr_matrix(([costs[k] for k in keys],([k[0] for k in keys],[k[1] for k in keys])),shape=(len(ids),len(ids)))
 if variant==1:
  arterial={ (index[u],index[v]):e['arterial'] for u,v,e in g.edges(data=True) }
  dump(cache,{'ids':ids,'coords':coords.tolist(),'edges':[[k[0],k[1],costs[k],int(arterial[k]),names[k]] for k in keys]})
 print('Simplified graph',len(ids),'nodes',len(costs),'edges',flush=True)
 return matrix,index,coords,tree,names,xy

def route_table(data,zones,trips,local,center,bike=False,variant=1):
 graph,index,coords,tree,names,xy=prepare_graph(data,bike,variant);cxy=np.array(WGS_TO_METRES.transform(*center));cluster=set(np.where(np.linalg.norm(xy-cxy,axis=1)<45)[0])
 centroids=zones.to_crs(31983).geometry.centroid;zid=zones.NumeroZona.astype(int).to_numpy();_,znodes=tree.query(np.column_stack([centroids.x,centroids.y]));zmap=dict(zip(zid,znodes))
 pairs=trips.groupby(['ZONA_O','ZONA_D'],observed=True).FE_VIA.sum().reset_index();assign={};unreachable=0
 print('Routing', 'bicycle' if bike else 'motor',variant,len(pairs),'OD pairs',flush=True)
 for origin,group in pairs.groupby('ZONA_O'):
  if int(origin) not in zmap:continue
  source=int(zmap[int(origin)]);dist,pred=dijkstra(graph,directed=True,indices=source,return_predecessors=True)
  for dest in group.ZONA_D:
   if int(dest) not in zmap:continue
   current=int(zmap[int(dest)]);visited=set();path=[]
   if not np.isfinite(dist[current]):unreachable+=1;continue
   while current!=source and current>=0 and current not in visited:
    visited.add(current);path.append(current);current=int(pred[current])
   path.append(source);path.reverse()
   positions=[i for i,n in enumerate(path) if n in cluster]
   if not positions or positions[0]==0:continue
   pos=positions[0];prev=path[pos-1];cross=path[pos];road=names.get((prev,cross),'')
   if 'Rio Pequeno' in road:movement='rio'
   else:movement='east' if xy[cross,0]>xy[prev,0] else 'west'
   assign[(int(origin),int(dest))]=movement
  # All pairs needed by local demand and regional passage are retained, not truncated to 2 km.
 result=trips[['ZONA_O','ZONA_D','MODOPRIN','H_SAIDA','FE_VIA','mode']].copy();result['movement']=[assign.get((int(o),int(d))) for o,d in zip(trips.ZONA_O,trips.ZONA_D)]
 probabilities={}
 for mode in MODES:
  mask=local & (trips['mode']==mode);den=trips.loc[mask,'FE_VIA'].sum()
  probabilities[mode]={m:float(trips.loc[mask & result.movement.eq(m),'FE_VIA'].sum()/den) if den else 0 for m in ['rio','east','west']}
 return result,probabilities,unreachable

def census(center):
 cx,cy=WGS_TO_METRES.transform(*center);circle=Point(cx,cy).buffer(2000)
 s=gpd.read_file(RAW/'census-sp/SP_setores_CD2022.shp').to_crs(31983);s=s[s.geometry.intersects(circle)].copy();s['fraction']=s.geometry.intersection(circle).area/s.geometry.area
 db=duckdb.connect();frame=db.sql(f"SELECT CD_SETOR::VARCHAR AS CD_SETOR, try_cast(v0001 AS DOUBLE) AS population, try_cast(v0007 AS DOUBLE) AS households FROM read_csv('{RAW}/census.csv', all_varchar=true)").df();db.close()
 s.CD_SETOR=s.CD_SETOR.astype(str);s=s.merge(frame,on='CD_SETOR',how='left');valid=s.population.notna() & s.households.notna()
 population=float((s.loc[valid,'population']*s.loc[valid,'fraction']).sum());households=float((s.loc[valid,'households']*s.loc[valid,'fraction']).sum())
 s.to_parquet(OUT/'census-buffer.parquet')
 return population,households,int((~valid).sum()),circle

def deduplicate_projects(records):
 # GeoSampa SQL is sector/quadra/lote (10 digits); PDE adds a check digit.
 def parcels(value):
  result=set()
  for item in re.split(r'[,; /]+',value or ''):
   digits=re.sub(r'\D','',re.sub(r'\.0$','',item))
   if not digits:continue
   result.add(digits[:10] if len(digits)==11 else digits.zfill(10) if len(digits)<=10 else digits)
  return result
 def merge(a,b,same_process=False):
  # PDE provides all residential units; HIS/HMP is a subset, not another project.
  if same_process and ('pde' in a['sourceIds'])!=('pde' in b['sourceIds']):chosen=a if 'pde' in a['sourceIds'] else b
  else:chosen=b if (b['licenseDate'] or '')>=(a['licenseDate'] or '') else a
  chosen=dict(chosen)
  chosen['parcel']=','.join(sorted(parcels(a['parcel'])|parcels(b['parcel'])))
  chosen['sourceIds']=sorted(set(a['sourceIds']+b['sourceIds']))
  chosen['evidence']=sorted(set(a['evidence']+b['evidence']))
  if chosen['units'] is None:chosen['units']=a['units'] if a['units'] is not None else b['units']
  return chosen
 groups={}
 for original in sorted(records,key=lambda p:p['licenseDate'] or ''):
  p=dict(original);p['evidence']=list(p['evidence'])+[f"SQL original: {p['parcel']}; processo: {p['process']}"]
  p['parcel']=','.join(sorted(parcels(p['parcel'])))
  process=re.sub(r'\D','',p['process'])
  key=('process',process) if process else ('parcel',p['parcel'] or re.sub(r'\W','',p['address'].casefold()))
  groups[key]=merge(groups[key],p,same_process=True) if key in groups else p
 # Connected sets of parcels merge revisions, including multi-parcel approvals.
 out=[]
 for p in groups.values():
  hits=[i for i,old in enumerate(out) if parcels(p['parcel']) & parcels(old['parcel'])]
  for i in reversed(hits):p=merge(out.pop(i),p)
  out.append(p)
 return sorted(out,key=lambda p:p['address'])
def projects(circle):
 records=[]
 p=gpd.read_file(RAW/'pde.gpkg').to_crs(31983);p=p[p.geometry.intersects(circle) & (p.unid_resid.fillna(0).gt(0)|p.uso.fillna('').str.contains('residencial',case=False))].to_crs(4326)
 for _,r in p.iterrows():
  process=str(r.processo) if pd.notna(r.processo) else '';parcel=str(r.sql) if pd.notna(r.sql) else '';units=int(r.unid_resid) if pd.notna(r.unid_resid) and r.unid_resid>0 else None
  point=r.geometry.representative_point();date=str(r.data_emissao)[:10] if pd.notna(r.data_emissao) else None
  records.append({'id':hashlib.sha256((process+'|'+parcel+'|'+str(r.endereco)).encode()).hexdigest()[:12],'process':process,'parcel':parcel,'address':str(r.endereco),'units':units,'coordinates':[point.x,point.y],'status':'Licenciado; obra e ocupação não verificadas','deliveryDate':None,'occupancyAtReference':None,'licenseDate':date,'sourceIds':['pde'],'evidence':[str(r.n_documento),str(r.assunto)]})
 p=gpd.read_file(RAW/'his.geojson').to_crs(31983);p=p[p.geometry.intersects(circle)].to_crs(4326)
 for _,r in p.iterrows():
  process=str(r.cd_numero_processo_execucao or '');parcel=str(r.cd_sql_incra or '');units=sum(float(r.get(k) or 0) for k in ['qt_unidade_his','qt_unidade_hmp']);date=str(r.dt_deferimento_execucao)[:10] if r.dt_deferimento_execucao else None
  records.append({'id':hashlib.sha256((process+'|'+parcel).encode()).hexdigest()[:12],'process':process,'parcel':parcel,'address':r.tx_grupo_endereco,'units':int(units) if units>0 else None,'coordinates':[r.geometry.x,r.geometry.y],'status':'Alvará HIS/HMP; obra e ocupação não verificadas','deliveryDate':None,'occupancyAtReference':None,'licenseDate':date,'sourceIds':['his'],'evidence':[r.cd_numero_documento_execucao or '',r.tx_assunto_alvara or '']})
 return deduplicate_projects(records)

def parameters(df,zones,table,network,local_zone_ids):
 t=table.copy();fam=df[df.F_FAM.eq(1)];t['income']=fam.assign(income=fam.RENDA_FA*fam.FE_FAM).groupby('ZONA').income.sum()/fam.groupby('ZONA').FE_FAM.sum()
 t['householdSize']=t.population/t.households;t['density']=t.population/t.area;t['jobsPerResident']=t.jobs/t.population
 station_points=np.array(network['stops']);station_tree=cKDTree(np.column_stack(WGS_TO_METRES.transform(station_points[:,0],station_points[:,1])))
 z=zones.to_crs(31983).set_index(zones.NumeroZona.astype(int));cent=z.geometry.centroid;dist,_=station_tree.query(np.column_stack([cent.x,cent.y]));t.loc[z.index,'accessibility']=1/(1+dist/1000)
 features=['income','householdSize','density','jobsPerResident','accessibility'];eligible=zones.loc[zones.NumeroMuni.eq(36),'NumeroZona'].astype(int)
 valid=t.loc[eligible].replace([np.inf,-np.inf],np.nan).dropna(subset=features);scale=valid[features].std().replace(0,1)
 local_table=t.loc[list(local_zone_ids)].replace([np.inf,-np.inf],np.nan).dropna(subset=features);local_table=local_table[local_table.population>0];target=np.average(local_table[features],axis=0,weights=local_table.population)
 valid['distance']=np.sqrt((((valid[features]-target)/scale)**2).mean(axis=1));valid=valid[~valid.index.isin(local_zone_ids)].sort_values('distance')
 trips=df[df.N_VIAG.gt(0)].copy();trips['mode']=classify(trips);params=[]
 for k in [3,5,10]:
  peers=valid.head(k).copy();w=1/peers.distance.clip(lower=.05);w=w/w.sum();peers['weight']=w
  subset=trips[trips.ZONA.isin(peers.index)].copy();subset['weight']=subset.FE_VIA*subset.ZONA.map(w/peers.population)
  rate=float(subset.weight.sum());modal=subset.groupby('mode').weight.sum();shares={m:float(modal.get(m,0)/rate) for m in MODES}
  purpose_names={1:'Trabalho · indústria',2:'Trabalho · comércio',3:'Trabalho · serviços',4:'Educação',5:'Compras',6:'Saúde',7:'Lazer e visitas',8:'Residência',9:'Procurar emprego',10:'Assuntos pessoais',11:'Refeição'}
  purpose_shares={purpose_names.get(int(code),f'Finalidade OD {int(code)}'):float(weight/rate) for code,weight in subset.groupby('MOTIVO').weight.sum().items()}
  hourly={}
  for m in MODES:
   counts=subset[subset['mode'].eq(m)].groupby('H_SAIDA').weight.sum().reindex(range(24),fill_value=0).to_numpy();hourly[m]=(counts/counts.sum()).tolist() if counts.sum() else [1/24]*24
  car=float(subset[subset.MODOPRIN.isin([9,10])].weight.sum()/max(subset[subset.MODOPRIN.eq(9)].weight.sum(),1e-12));moto=float(subset[subset.MODOPRIN.isin([13,14])].weight.sum()/max(subset[subset.MODOPRIN.eq(13)].weight.sum(),1e-12))
  cmp=[]
  for i,r in peers.iterrows():cmp.append({'id':int(i),'name':r['name'],'distance':float(r.distance),'weight':float(r.weight),'population':float(r.population),'sampledTrips':int((subset.ZONA==i).sum()),**{f:float(r[f]) for f in features}})
  params.append({'k':k,'rate':rate,'shares':shares,'purposeShares':purpose_shares,'hourly':hourly,'occupancy':{'car':max(1,min(8,car)),'moto':max(1,min(2,moto))},'comparables':cmp})
 return params

def build():
 RAW.mkdir(parents=True,exist_ok=True);OUT.mkdir(parents=True,exist_ok=True)
 raw_hashes={file:digest(RAW/file) for file in URLS}
 cache_key=hashlib.sha256(json.dumps({'sources':raw_hashes,'algorithm':VERSION},sort_keys=True).encode()).hexdigest()
 identity=OUT/'cache-identity.json'
 if identity.exists() and json.loads(identity.read_text())['key']!=cache_key:
  for folder in ['od2023','census-sp']:
   if (RAW/folder).exists():shutil.rmtree(RAW/folder)
  shutil.rmtree(OUT);OUT.mkdir(parents=True)
 dump(identity,{'key':cache_key,'rawSha256':raw_hashes,'algorithm':VERSION})
 extract();center,intersection_ids=intersection();df=od_frame();table=table_one()
 zones=gpd.read_file(RAW/'od2023/Site_190225/002_Site Metro Mapas_190225/Shape/Zonas_2023.shp');data=network(zones,center)
 pop,households,census_missing,circle=census(center);localzones=zones.to_crs(31983);localzones=localzones[localzones.geometry.intersects(circle)];localids=set(localzones.NumeroZona.astype(int))
 params=parameters(df,zones,table,data,localids)
 trips=df[df.N_VIAG.gt(0)&df.ZONA_O.gt(0)&df.ZONA_D.gt(0)].copy().reset_index(drop=True);trips['mode']=classify(trips)
 transform=Transformer.from_crs(zones.crs,31983,always_xy=True);x,y=transform.transform(trips.CO_DOM_X.to_numpy(),trips.CO_DOM_Y.to_numpy());cx,cy=WGS_TO_METRES.transform(*center);local=pd.Series((x-cx)**2+(y-cy)**2<=2000**2,index=trips.index)
 cache=OUT/'routing.parquet'
 if cache.exists():
  routed=pd.read_parquet(cache);routing=json.loads((OUT/'routing.json').read_text());unreachable=0
 else:
  routed,routing,unreachable=route_table(data,zones,trips,local,center);routed.to_parquet(cache);dump(OUT/'routing.json',routing)
 # Bicycle routing uses its own directed graph and a spatial intersection cluster.
 bike_trips=trips[trips['mode'].eq('bike')].copy();bike_local=local.loc[bike_trips.index]
 if (OUT/'bike-routing.parquet').exists():bike_routed=pd.read_parquet(OUT/'bike-routing.parquet');routing['bike']=json.loads((OUT/'bike-routing.json').read_text())
 else:
  bike_routed,bike_prob,_=route_table(data,zones,bike_trips,bike_local,center,bike=True);routing['bike']=bike_prob['bike'];bike_routed.to_parquet(OUT/'bike-routing.parquet');dump(OUT/'bike-routing.json',routing['bike'])
 variants={}
 for factor,label in [(.8,'Arteriais −20% de velocidade'),(1.2,'Arteriais +20% de velocidade')]:
  path=OUT/f'routing-{factor}.json'
  if path.exists():v=json.loads(path.read_text())
  else:_,v,_=route_table(data,zones,trips,local,center,variant=factor);dump(path,v)
  v['bike']=routing['bike'];variants[label]=v
 movement_names={'rio':'Rio Pequeno · chegada à Corifeu','east':'Corifeu · sentido Butantã','west':'Corifeu · sentido Osasco'}
 baseline={}
 for m in movement_names:
  hours=[]
  for h in range(24):
   f=routed[routed.movement.eq(m)&routed.H_SAIDA.eq(h)]
   bikes=bike_routed[bike_routed.movement.eq(m)&bike_routed.H_SAIDA.eq(h)]
   hours.append({'car':float(f.loc[f.MODOPRIN.eq(9),'FE_VIA'].sum()),'moto':float(f.loc[f.MODOPRIN.eq(13),'FE_VIA'].sum()),'bus':None,'bike':float(bikes.FE_VIA.sum())})
  baseline[m]=hours
 movements=[{'id':m,'name':name,'coordinates':[]} for m,name in movement_names.items()]
 ps=projects(circle)
 population_error=float((df[df.F_PESS.eq(1)].groupby('ZONA').FE_PESS.sum()-table.population).abs().max())
 households_error=float((df[df.F_DOM.eq(1)].groupby('ZONA').FE_DOM.sum()-table.households).abs().max())
 families=df[df.F_FAM.eq(1)];declared=families[families.AUTO_DECL.eq(1)];mean_cars=(declared.QT_AUTO*declared.FE_FAM).groupby(declared.ZONA).sum()/declared.groupby('ZONA').FE_FAM.sum()
 cars_error=float((mean_cars*table.families-table.cars).abs().max())
 trip_error=float((trips.groupby('ZONA_O').FE_VIA.sum()-table.produced).abs().max())
 if population_error>5 or households_error>5 or trip_error>5:raise ValueError(f'OD validation failed: {population_error}, {households_error}, {trip_error}')
 sources=[]
 meta=[('od','OD 2023 · Metrô','od2023.zip','2023 / revisão 19-02-2025','Dados públicos do Metrô; citar a pesquisa',['DBF → Parquet; flags F_DOM/F_FAM/F_PESS; FE_VIA; modos 9 e 13 são motoristas']),('census','Censo 2022 · IBGE','census.csv','2022 / publicação 2024','Dados públicos do IBGE',['V0001 população; V0007 domicílios ocupados; interseção proporcional à área do setor']),('census-geometry','Malha censitária · IBGE','census-sp.zip','2022 / malha definitiva 2024','Dados públicos do IBGE',['Reprojeção EPSG:31983; buffer de 2.000 m']),('pde','Alvarás residenciais · PDE','pde.gpkg','Até dezembro/2024','Portal municipal: Creative Commons; modalidade não explicitada',['Filtro espacial; usos residenciais; deduplicação conservadora por SQL; sem inferência de entrega']),('his','Habitação HIS/HMP · GeoSampa','his.geojson','Extração corrente / metadados setembro/2026','Metadados: sem restrição de acesso; licença não especificada',['WFS público; unidades HIS+HMP; deduplicação com PDE']),('osm','Rede viária · OpenStreetMap','sudeste.osm.pbf','Snapshot do extrato baixado','ODbL 1.0 · © OpenStreetMap contributors',['Extrato regional → grafo direcionado OSMnx; menor tempo livre; regiões externas incluídas']),('intersection','Interseção · OpenStreetMap','intersection.osm','Consulta 2026-10-03','ODbL 1.0',['Centro entre nós comuns às duas avenidas; agrupamento espacial de 45 m'])]
 for sid,title,file,version,license,transforms in meta:
  sources.append({'id':sid,'title':title,'url':URLS[file],'version':version,'collectedAt':dt.datetime.fromtimestamp((RAW/file).stat().st_mtime,dt.timezone.utc).isoformat(),'sha256':raw_hashes[file],'status':'integrated','license':license,'transformations':transforms})
 for sid,title,url in [('cet','Contagens locais · CET','https://ssl.cetsp.com.br/sobre-a-cet/relatorios-corporativos.aspx'),('sptrans','Oferta de ônibus · SPTrans','https://www.sptrans.com.br/desenvolvedores/')]:sources.append({'id':sid,'title':title,'url':url,'version':'Não integrada','collectedAt':REFERENCE,'sha256':None,'status':'unavailable','license':'Consultar fonte','transformations':[]})
 implementation={str(p.relative_to(ROOT)):digest(p) for p in [ROOT/'pipeline/study.py',ROOT/'pipeline/counts.py',ROOT/'lib/model/contracts.ts',ROOT/'lib/model/engine.ts',ROOT/'requirements.lock',ROOT/'package-lock.json']}
 run=hashlib.sha256((json.dumps({'sources':raw_hashes,'implementation':implementation},sort_keys=True)+VERSION+REFERENCE).encode()).hexdigest()[:16]
 gaps=['Contagens recentes por movimento não integradas: referência de fluxo estimada a partir da OD 2023.','Fluxo de ônibus desconhecido; o total de automotores não pode ser apresentado como completo.','Alvarás não comprovam obra, entrega ou ocupação. Cronogramas desconhecidos aguardam hipótese explícita.','Viagens de carga, táxi/aplicativo e deslocamentos vazios não estimados.','Rotas usam conectores de zonas OD, velocidades livres e sentidos OSM; restrições de conversão não são modeladas.','Horário corresponde à saída da viagem, sem deslocamento temporal até a passagem pelo cruzamento.']
 if cars_error>5:gaps.append('A frota domiciliar recalculada com respostas declaradas diverge da tabela oficial. A frota não é utilizada para gerar fluxos: o modelo utiliza viagens e motoristas ponderados, conferidos com as viagens oficiais.')
 if census_missing:gaps.append(f'{census_missing} setores possuem valores censitários suprimidos/ausentes; população agregada parcial.')
 gaps.append('Amostra local pequena para certos modos; ausência de passagem amostral não comprova ausência de fluxo. Probabilidades de passagem são coeficientes exploratórios.')
 assumptions=['Padrões OD 2023 mantidos na referência 2026; nenhuma contagem em tempo real.','Censo 2022 recortado proporcionalmente à área; não equivale a população observada em 2026.','Demanda externa constante; ocupação hipotética linear em 24 meses. Incremento manual cresce linearmente até o ano selecionado.','Faixas combinam k=3/5/10, velocidades arteriais ±20%, taxa de viagens ±20% e ocupações ±20% (limitadas fisicamente); são sensibilidade, não confiança estatística.','Acessibilidade usa distância do centro da zona a parada/estação OSM mais próxima como proxy.','Alvarás no mesmo lote são deduplicados conservadoramente; fases independentes podem ser agrupadas.','Fora de 12 km, a atribuição usa vias arteriais e conectores dos centroides, sem representar acessos locais detalhados.','Projetos e incremento manual compartilham probabilidades regionais de passagem, estimadas das viagens de moradores no raio; acessos de cada condomínio não são modelados.']
 zgeo=json.loads(localzones.to_crs(4326)[['NumeroZona','NomeZona','geometry']].to_json())
 stats={'odRecords':len(df),'odTrips':len(trips),'regionalNodes':len(data['nodes']),'regionalEdges':len(data['edges']),'crossingSampleTrips':int(routed.movement.notna().sum()),'localResidentSampleTrips':int(local.sum()),'projects':len(ps),'licensedUnits':sum(p['units'] or 0 for p in ps),'unreachablePairs':unreachable}
 manifest={'schemaVersion':'1.0','modelVersion':VERSION,'runId':run,'referenceDate':REFERENCE,'horizon':2036,'generatedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'sources':sources,'gaps':gaps,'assumptions':assumptions,'validation':{'odMaxPopulationError':population_error,'odMaxHouseholdError':households_error,'odMaxCarOwnershipError':cars_error,'odMaxProducedTripsError':trip_error,'carOwnershipStatus':'Discrepância documentada; frota não usada no fluxo' if cars_error>5 else 'Conferida','populationRebase':'Padrões históricos mantidos, sem projeção demográfica silenciosa','routing':'Conectores de centroides OD; vizinhos externos incluídos'}}
 manifest['implementationSha256']=implementation
 bundle={'schemaVersion':'1.0','coverage':{'motorTotalComplete':False,'unavailableCategories':['bus','freight','taxi/app','empty']},'manifest':manifest,'center':center,'radiusM':2000,'population':pop,'households':households,'populationMethod':'Censo 2022; interpolação por área dos setores; V0007 domicílios ocupados','projects':ps,'movements':movements,'parameters':params,'routing':routing,'baseline':baseline,'routingVariants':variants,'roads':{'type':'FeatureCollection','features':data['roads']},'zones':zgeo,'stats':stats}
 dump(ROOT/'public/data/study.json',bundle);dump(ROOT/'public/data/manifest.json',manifest);dump(OUT/'validation.json',manifest['validation']);print('Exported',run,stats,flush=True)

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('command',choices=['download','build']);parser.add_argument('--clean-cache',action='store_true',help='Rebuild derived artifacts when changing processing code');args=parser.parse_args()
 if args.clean_cache and OUT.exists():shutil.rmtree(OUT)
 if args.command=='download':download()
 else:build()
