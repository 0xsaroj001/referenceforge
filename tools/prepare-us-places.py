"""Pinned public Census data preparation only. Never extract or execute archive files."""
import csv, hashlib, io, json, pathlib, urllib.request, zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
BASE = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2026_Gazetteer/'
PINS = {'place': 'af678e2d990827c89ee39b98c82de6e90b693c7361ff0e559ae3076670dd2863',
        'state': '54352ca34f869b4deca03a65da72cccb8e9f0c2702340061949b63c76c63f852'}

def load(kind):
    name = f'2026_Gaz_{kind}_national.zip'
    archive = ROOT / 'reports/location-census/source' / name
    archive.parent.mkdir(parents=True, exist_ok=True)
    if archive.exists():
        raw = archive.read_bytes()
    else:
        with urllib.request.urlopen(BASE + name, timeout=25) as response:
            raw = response.read(2_000_001)
    assert len(raw) <= 2_000_000, 'Archive exceeds bound'
    assert hashlib.sha256(raw).hexdigest() == PINS[kind], 'Census source drift; review rather than repin automatically'
    member = f'2026_Gaz_{kind}_national.txt'
    with zipfile.ZipFile(io.BytesIO(raw)) as zipped:
        assert zipped.namelist() == [member], 'Unexpected archive members'
        assert zipped.getinfo(member).file_size < 10_000_000, 'Expanded data exceeds bound'
        text = zipped.read(member).decode('utf-8-sig', errors='strict')
    reader = csv.DictReader(io.StringIO(text), delimiter='|')
    needed = {'USPS', 'GEOID', 'NAME', 'INTPTLAT', 'INTPTLONG'} | ({'LSAD'} if kind == 'place' else set())
    assert needed.issubset(reader.fieldnames), 'Census field layout changed'
    rows = list(reader)
    archive.write_bytes(raw)
    return rows, {'url': BASE + name, 'sha256': PINS[kind], 'member': member,
                  'member_sha256': hashlib.sha256(text.encode()).hexdigest(), 'rows': len(rows)}

def main():
    places, place_source = load('place')
    states, state_source = load('state')
    assert 30_000 <= len(places) <= 40_000 and 51 <= len(states) <= 60
    assert len({r['GEOID'] for r in places}) == len(places), 'Duplicate place GEOID'
    state_names = {r['USPS']: r['NAME'] for r in states}
    output = []
    for row in places:
        assert row['USPS'] in state_names and len(row['GEOID']) == 7 and row['GEOID'].isdigit()
        assert -90 <= float(row['INTPTLAT']) <= 90 and -180 <= float(row['INTPTLONG']) <= 180
        assert row['NAME'] and len(row['NAME']) < 160
        output.append([row[k] for k in ['USPS', 'GEOID', 'NAME', 'LSAD', 'INTPTLAT', 'INTPTLONG']])
    result = {'schema': 'census_places_v1', 'vintage': 2026,
              'source': {'places': place_source, 'states': state_source},
              'states': state_names, 'places': output}
    raw = (json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n').encode()
    path = ROOT / 'dist/census/us-places-2026.json'
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(raw)
    manifest = {'file': str(path), 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(),
                'places': len(output), 'states': len(state_names), 'sources': result['source'],
                'scope': 'Local public-data transform; no weather request, upload or registration'}
    (ROOT / 'reports/location-census/prepared.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(manifest, indent=2))

if __name__ == '__main__':
    main()
