import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'pipeline'))
from study import deduplicate_projects
from counts import calibrate, load_counts
import pandas as pd
import pytest

def test_dedup_does_not_sum_revisions():
 def p(units,date,process='A'):return dict(id=process,process=process,parcel='123',address='Rua A',units=units,licenseDate=date,sourceIds=['pde'],evidence=[date])
 result=deduplicate_projects([p(100,'2023-01-01'),p(120,'2024-01-01'),p(120,'2024-01-02','B')])
 assert len(result)==1 and result[0]['units']==120
 assert all(date in result[0]['evidence'] for date in ['2023-01-01','2024-01-01','2024-01-02'])
def test_counts_have_independent_validation(tmp_path):
 path=tmp_path/'counts.csv';path.write_text('date,start_time,interval_minutes,movement,mode,count,split\n2026-09-01,08:00,15,rio,car,10,train\n2026-09-01,09:00,15,rio,car,12,validation\n')
 with pytest.raises(ValueError,match='distinct'):load_counts(path)
def test_calibration_and_missing_bus():
 b={'baseline':{'rio':[{'car':40,'moto':10,'bus':None,'bike':None} for _ in range(24)]},'manifest':{'validation':{},'assumptions':[]}}
 rows=[dict(date='2026-09-01',start_time='08:00',interval_minutes=15,movement='rio',mode='car',count=20,split='train',hour=8),dict(date='2026-09-02',start_time='08:00',interval_minutes=15,movement='rio',mode='car',count=18,split='validation',hour=8)]
 out=calibrate(b,pd.DataFrame(rows));report=out['manifest']['validation']['localCounts'][0]
 assert out['baseline']['rio'][8]['car']==80 and b['baseline']['rio'][8]['car']==40
 assert report['mae']==2 and report['wape']==pytest.approx(2/18)
 assert out['baseline']['rio'][8]['bus'] is None

def test_counts_reject_overlapping_intervals(tmp_path):
 path=tmp_path/'counts.csv';path.write_text('date,start_time,interval_minutes,movement,mode,count,split\n2026-09-01,08:00,30,rio,car,10,train\n2026-09-01,08:15,30,rio,car,10,train\n2026-09-02,08:00,15,rio,car,12,validation\n')
 with pytest.raises(ValueError,match='Overlapping'):load_counts(path)


def test_sql_check_digit_and_his_subset():
 def p(source,sql,units,date,process):return dict(id=source,process=process,parcel=sql,address='Rua A',units=units,licenseDate=date,sourceIds=[source],evidence=[source])
 result=deduplicate_projects([p('pde','10152800076,10152800080',290,'2023-07-13','1020.2023/0010026-5'),p('his','1015280007',225,'2023-07-16','1020202300100265')])
 assert len(result)==1 and result[0]['units']==290
 assert result[0]['parcel']=='1015280007,1015280008'
 assert result[0]['sourceIds']==['his','pde']
