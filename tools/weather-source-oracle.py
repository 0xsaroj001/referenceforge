"""Independent standard-library Decimal check of captured NWS source normalization.
Uses the same source facts; this is not independent meteorological ground truth.
"""
import json
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from datetime import datetime

root = Path(__file__).resolve().parents[1]
directory = root / 'reports' / 'weather'
latest = json.loads((directory / 'latest-live.json').read_text())
report = json.loads((directory / latest['report']).read_text())
captures = json.loads((directory / latest['captures']).read_text())
payloads = {r['url']: json.loads(r['text'], parse_float=Decimal) for r in captures if r['status'] == 200}
checked = []
def time(s):
    return datetime.fromisoformat(s.replace('Z', '+00:00'))
def rounded(value):
    return Decimal(value).quantize(Decimal('.001'), rounding=ROUND_HALF_UP)
for row in report['rows']:
    assert row['pass'], row['city'] + ':' + row['kind']
    answer = row['answer']
    if row['kind'] == 'forecast':
        source = next(payloads[s['source_url']] for s in answer['sources'] if '/forecast/hourly' in s['source_url'])
        by_time = {time(p['startTime']): p for p in source['properties']['periods']}
        for h in answer['hourly']:
            raw = by_time[time(h['start_time'])]
            expected = Decimal(raw['temperature'])
            if raw['temperatureUnit'] == 'F':
                expected = (expected - 32) * 5 / 9
            assert abs(Decimal(str(h['temperature_c'])) - expected) <= Decimal('.00051')
            assert h['precipitation_probability_pct'] == raw['probabilityOfPrecipitation']['value']
        checked.append({'case': row['city'] + ':forecast', 'hours': len(answer['hourly']), 'pass': True})
    elif row['kind'] == 'current':
        source = next(payloads[s['source_url']] for s in answer['sources'] if '/observations/latest' in s['source_url'])
        assert answer['observed_at'] == source['properties']['timestamp']
        assert answer['station']['id'] in source['properties']['station']
        q = source['properties']['temperature']
        expected = Decimal(q['value'])
        if q['unitCode'] == 'wmoUnit:degF':
            expected = (expected - 32) * 5 / 9
        assert abs(Decimal(str(answer['metrics']['temperature'])) - expected) <= Decimal('.00051')
        checked.append({'case': row['city'] + ':current', 'pass': True})
    else:
        source = next(payloads[s['source_url']] for s in answer['sources'] if '/alerts?' in s['source_url'])
        raw_ids = {f['properties']['id'] for f in source['features']}
        assert all(a['id'] in raw_ids and a['instruction'] == next(f['properties']['instruction'] for f in source['features'] if f['properties']['id'] == a['id']) for a in answer['alerts'])
        assert answer['all_clear'] is False
        checked.append({'case': row['city'] + ':alerts', 'pass': True})
result = {'passed': len(checked), 'total': len(report['rows']), 'checks': checked, 'scope': 'Independent Python source-conformance checks on the same captured NWS facts; no forecast-skill claim.'}
(directory / 'source-oracle.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
