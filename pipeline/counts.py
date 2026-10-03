"""Calibrate an aggregated bundle from classified counts, locally, with held-out days."""
import argparse, hashlib, json
from pathlib import Path
import numpy as np
import pandas as pd

def load_counts(path):
 d=pd.read_csv(path,dtype={'movement':str,'mode':str,'split':str,'start_time':str})
 required={'date','start_time','interval_minutes','movement','mode','count','split'}
 if not required.issubset(d.columns):raise ValueError(f'Required columns: {sorted(required)}')
 d['date']=pd.to_datetime(d.date,format='%Y-%m-%d',errors='raise')
 if not d.start_time.str.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d').all():raise ValueError('Invalid start_time')
 d['hour']=d.start_time.str[:2].astype(int);minute=d.start_time.str[3:].astype(int)
 if d.empty or d.isna().any().any():raise ValueError('Empty or missing count values')
 if not np.isfinite(d['count']).all() or not np.isfinite(d.interval_minutes).all():raise ValueError('Nonfinite counts')
 if (d['count']<0).any() or (d['count']%1!=0).any():raise ValueError('Counts must be nonnegative integers')
 if (d.interval_minutes<=0).any() or (minute+d.interval_minutes>60).any():raise ValueError('Intervals must stay inside an hour')
 if not d.movement.isin(['rio','east','west']).all() or not d['mode'].isin(['car','moto','bus','bike']).all():raise ValueError('Unknown movement/mode')
 if not d.split.isin(['train','validation']).all():raise ValueError('Unknown split')
 if set(d[d.split=='train'].date)&set(d[d.split=='validation'].date):raise ValueError('Training and validation days must be distinct')
 if not {'train','validation'}.issubset(set(d.split)):raise ValueError('Both training and held-out validation days are required')
 if (d.date.dt.dayofweek>4).any():raise ValueError('The OD reference models weekdays only')
 if d.duplicated(['date','start_time','movement','mode']).any():raise ValueError('Duplicate count interval')
 d['start_minute']=d.hour*60+minute
 for _,group in d.groupby(['date','movement','mode']):
  ordered=group.sort_values('start_minute')
  if np.any(ordered.start_minute.to_numpy()[1:]<(ordered.start_minute+ordered.interval_minutes).to_numpy()[:-1]):raise ValueError('Overlapping count intervals')
 return d

def calibrate(bundle,counts):
 result=json.loads(json.dumps(bundle));reports=[]
 for (movement,mode),group in counts.groupby(['movement','mode']):
  train=group[group.split=='train'];valid=group[group.split=='validation'];base=bundle['baseline'][movement]
  if train.empty or valid.empty:continue
  predicted=np.array([base[int(r.hour)][mode] for _,r in train.iterrows()],dtype=float)*train.interval_minutes.to_numpy()/60
  if np.isfinite(predicted).all() and np.dot(predicted,predicted)>0:
   factor=float(np.dot(predicted,train['count'])/np.dot(predicted,predicted))
   for h in range(24):
    if result['baseline'][movement][h][mode] is not None:result['baseline'][movement][h][mode]*=factor
   predictions=np.array([result['baseline'][movement][int(r.hour)][mode]*r.interval_minutes/60 for _,r in valid.iterrows()]);method='nonnegative least-squares scale'
  else:
   # Missing baseline is not zero: use train means only for actually measured hours.
   rates=train.assign(rate=train['count']*60/train.interval_minutes).groupby('hour').rate.mean()
   for h,value in rates.items():result['baseline'][movement][int(h)][mode]=float(value)
   predictions=np.array([(result['baseline'][movement][int(r.hour)][mode] if int(r.hour) in rates else np.nan)*r.interval_minutes/60 for _,r in valid.iterrows()]);factor=None;method='measured-hour means; other hours remain unavailable'
  mask=np.isfinite(predictions);observed=valid['count'].to_numpy()[mask];err=np.abs(predictions[mask]-observed);den=observed.sum()
  reports.append({'movement':movement,'mode':mode,'factor':factor,'method':method,'validationRows':int(mask.sum()),'excludedValidationRows':int((~mask).sum()),'mae':float(err.mean()) if len(err) else None,'wape':float(err.sum()/den) if den else None})
 if not reports:raise ValueError('No comparable training and validation groups')
 result['manifest']['validation']['localCounts']=reports
 if 'gaps' in result['manifest']:
  result['manifest']['gaps']=[g for g in result['manifest']['gaps'] if not g.startswith('Contagens recentes por movimento não integradas')]
  result['manifest']['gaps'].append('Calibração local parcial: somente classes, aproximações e períodos medidos. Categorias e horários sem informação permanecem indisponíveis; conferir métricas de validação reservada.')
 result['manifest']['assumptions'].append('Contagens locais calibram a referência por classe/aproximação; incrementos populacionais mantêm o modelo de demanda. Nenhum intervalo de confiança foi estimado.')
 return result

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('counts');p.add_argument('--bundle',default='public/data/study.json');p.add_argument('--output',default='data/processed/calibrated-study.json');a=p.parse_args()
 b=json.loads(Path(a.bundle).read_text());counts=load_counts(a.counts);out=calibrate(b,counts);sha=hashlib.sha256(Path(a.counts).read_bytes()).hexdigest()
 out['manifest']['runId']=hashlib.sha256((b['manifest']['runId']+sha).encode()).hexdigest()[:16];out['manifest']['sources'].append({'id':'local-counts','title':'Contagens locais importadas','url':'','version':f'{counts.date.min().date()} a {counts.date.max().date()}','collectedAt':str(counts.date.max().date()),'sha256':sha,'status':'integrated','license':'Definida pelo pesquisador','transformations':['Dados processados localmente; ajuste com dias distintos de validação; saída agregada']})
 Path(a.output).parent.mkdir(parents=True,exist_ok=True);Path(a.output).write_text(json.dumps(out,ensure_ascii=False,allow_nan=False));print(json.dumps(out['manifest']['validation']['localCounts'],indent=2))
