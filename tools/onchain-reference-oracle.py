"""Independent integer/event decoding of captured raw RPC facts, not independent truth."""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1] / 'reports' / 'onchain-miner'
report = json.loads((root / 'live-benchmark.json').read_text(encoding='utf-8'))
topic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
checks = []
for row in report['rows']:
    errors = []
    answer, params, ref = row['answer'], row['params'], row['reference']
    def check(ok, name):
        if not ok:
            errors.append(name)
    check(row['http_status'] == 200, 'HTTP fulfillment')
    if row['http_status'] == 200:
        check(answer['chain_id'] == ('8453' if params['chain'] == 'base' else '84532'), 'chain')
        if ref:
            tx, receipt = ref['tx'], ref['receipt']
            succeeded = int(receipt['status'], 16) == 1
            check(answer['state'] == ('mined_success' if succeeded else 'reverted'), 'execution state')
            check(answer['block']['hash'].lower() == receipt['blockHash'].lower(), 'inclusion block')
            check(answer['fees']['execution_fee_wei'] == str(int(receipt['gasUsed'], 16) * int(receipt['effectiveGasPrice'], 16)), 'execution fee')
            if receipt.get('l1Fee') is not None:
                check(answer['fees']['l1_data_fee_wei'] == str(int(receipt['l1Fee'], 16)), 'L1 data fee')
                check(answer['fees']['known_fee_subtotal_wei'] == str(int(receipt['gasUsed'], 16) * int(receipt['effectiveGasPrice'], 16) + int(receipt['l1Fee'], 16)), 'known fee subtotal')
            check(answer['transaction']['value_wei'] == str(int(tx['value'], 16)), 'integer precision')
            if row['kind'] == 'transfer':
                matches = []
                if succeeded and params['asset'] == 'native' and tx['to'] and int(tx['value'], 16) > 0:
                    matches = [(tx['from'].lower(), tx['to'].lower(), str(int(tx['value'], 16)))]
                if succeeded and params['asset'] == 'erc20':
                    for event in receipt['logs']:
                        if event['address'].lower() == params['token'].lower() and len(event['topics']) == 3 and event['topics'][0].lower() == topic:
                            matches.append(('0x' + event['topics'][1][-40:].lower(), '0x' + event['topics'][2][-40:].lower(), str(int(event['data'], 16))))
                expected = any(all(params.get(key, value).lower() == value.lower() for key, value in zip(['expected_from', 'expected_to', 'expected_amount'], match)) for match in matches)
                check(answer['claim_verified'] == expected, 'transfer predicates')
                check([(x['from'], x['to'], x['amount_raw']) for x in answer['transfers']] == matches, 'transfer evidence')
            else:
                metric = params['metric']
                expected = str(int(receipt['gasUsed'], 16)) if metric == 'gas' else str(len(receipt['logs'])) if metric == 'logs' else '1' if succeeded else '0'
                check(answer['score_value'] == expected, 'metric value')
        else:
            check(row['state_reference'] is not None, 'state reference available')
            if row['state_reference'] is not None:
                check(answer['value_raw'] == str(int(row['state_reference'], 16)), 'block-pinned balance')
    checks.append({'id': row['id'], 'round': row['round'], 'pass': not errors, 'errors': errors})
output = {'method': 'Independent Python exact-integer/event transformation of the same captured RPC data; not an independent truth source or reviewer', 'total': len(checks), 'passed': sum(x['pass'] for x in checks), 'checks': checks}
(root / 'python-oracle.json').write_text(json.dumps(output, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'total': output['total'], 'passed': output['passed'], 'failures': [x for x in checks if not x['pass']]}, indent=2))
raise SystemExit(0 if output['passed'] == output['total'] else 1)
