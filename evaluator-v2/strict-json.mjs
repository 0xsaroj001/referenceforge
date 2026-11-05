// Local ambiguity gate for evaluation rows. JSON syntax is validated first;
// duplicate decoded member names are then refused in every object scope.
// No row values or property names are included in errors or diagnostics.
export function parseUniqueJson(raw) {
  const value = JSON.parse(raw);
  const scopes = [];
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index];
    if (char === '"') {
      const start = index++;
      for (; index < raw.length; index++) {
        if (raw[index] === '\\') index++;
        else if (raw[index] === '"') break;
      }
      let next = index + 1;
      while (/\s/.test(raw[next] ?? '') && next < raw.length) next++;
      if (raw[next] === ':') {
        const key = JSON.parse(raw.slice(start, index + 1));
        const keys = scopes.at(-1);
        if (keys.has(key)) throw Object.assign(new Error('DUPLICATE_JSON_KEY'), { code: 'DUPLICATE_JSON_KEY' });
        keys.add(key);
      }
    } else if (char === '{') scopes.push(new Set());
    else if (char === '[') scopes.push(null);
    else if (char === '}' || char === ']') scopes.pop();
  }
  return value;
}
