"""Independent transport/transformation oracle. No miner implementation imports.

Uses Python's XML parser and Decimal; references still share the captured official
upstream with the miner and do not independently validate that upstream's truth.
"""
import sys, json, decimal, xml.etree.ElementTree as ET
decimal.getcontext().prec = 80
data = json.load(sys.stdin)
out = []
for case in data:
    if case['kind'] == 'fx':
        root = ET.fromstring(case['text'])
        rates = {'EUR': decimal.Decimal(1)}
        date = None
        for node in root.iter():
            if 'time' in node.attrib:
                date = node.attrib['time']
            if 'currency' in node.attrib:
                rates[node.attrib['currency']] = decimal.Decimal(node.attrib['rate'])
        result = rates[case['quote']] / rates[case['base']]
        result = result.quantize(decimal.Decimal('0.000000000001'), rounding=decimal.ROUND_HALF_UP)
        out.append({'value': str(result), 'period': date})
    else:
        payload = json.loads(case['text'], parse_float=decimal.Decimal, parse_int=decimal.Decimal)
        rows = [r for r in payload[1] if r['country']['id'] == case['country'] and r['indicator']['id'] == case['indicator'] and r['date'] == case['year']]
        if len(rows) != 1 or rows[0]['value'] is None:
            raise ValueError('Missing or ambiguous expected observation')
        out.append({'value': str(rows[0]['value']), 'period': rows[0]['date']})
json.dump(out, sys.stdout)
