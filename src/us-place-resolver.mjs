// Offline exact-name resolver. No popularity, inferred state or fuzzy fallback.
const fail=code=>{throw Object.assign(new Error(code),{code});};
const normalize=s=>s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[.'’]/g,'').replace(/[,\s]+/g,' ').trim();
const suffixes={'21':' borough','25':' city','37':' municipality','43':' town','47':' village','53':' city and borough','57':' CDP','55':' comunidad','62':' zona urbana','UG':' unified government','CG':' consolidated government','UC':' urban county','MG':' metropolitan government','CN':' corporation'};
export function createUSPlaceResolver(data){
  if(data?.schema!=='census_places_v1'||data.vintage!==2026||!Array.isArray(data.places)||data.places.length>40000||!data.states||!data.source)fail('INVALID_PLACE_DATA');
  const states=new Map(),exact=new Map(),aliases=new Map(),ids=new Set(),source=structuredClone(data.source);
  for(const [code,name]of Object.entries(data.states)){if(!/^[A-Z]{2}$/.test(code)||typeof name!=='string')fail('INVALID_STATE_DATA');states.set(normalize(code),code);states.set(normalize(name),code);}
  const add=(index,key,row)=>{const list=index.get(key)??[];list.push(row);index.set(key,list);};
  for(const inputRow of data.places){
    const row=Array.isArray(inputRow)?[...inputRow]:inputRow;
    if(!Array.isArray(row)||row.length!==6||row.some(x=>typeof x!=='string'))fail('INVALID_PLACE_ROW');
    const [state,id,name,lsad,lat,lon]=row;
    if(!data.states[state]||!/^\d{7}$/.test(id)||ids.has(id)||!name||name.length>160||!/^[-+]?\d+\.\d{1,8}$/.test(lat)||!/^[-+]?\d+\.\d{1,8}$/.test(lon)||Math.abs(Number(lat))>90||Math.abs(Number(lon))>180)fail('INVALID_PLACE_ROW');ids.add(id);
    add(exact,state+'|'+normalize(name),row);
    const suffix=suffixes[lsad];if(suffix&&name.toLowerCase().endsWith(suffix.toLowerCase()))add(aliases,state+'|'+normalize(name.slice(0,-suffix.length)),row);
  }
  return location=>{
    if(typeof location!=='string'||location.length>256||/[\x00-\x1f\x7f]/.test(location))fail('INVALID_LOCATION');
    const parts=location.split(',').map(x=>x.trim());
    if(parts.length>2&&['us','usa','united states','united states of america'].includes(normalize(parts.at(-1))))parts.pop();
    if(parts.length<2||parts.some(x=>!x)||parts.length>4)fail('LOCATION_STATE_REQUIRED');
    const state=states.get(normalize(parts.pop()));if(!state)fail('UNSUPPORTED_STATE');
    const name=normalize(parts.join(', '));if(!name)fail('INVALID_LOCATION');
    // A legal suffix can also be part of another place's proper name (e.g.
    // Rockwell city versus Rockwell City city). Neither index has precedence.
    const candidates=[...(exact.get(state+'|'+name)??[]),...(aliases.get(state+'|'+name)??[])];
    const matches=[...new Map(candidates.map(row=>[row[1],row])).values()];
    if(matches.length===0)fail('PLACE_NOT_FOUND');if(matches.length!==1)fail('AMBIGUOUS_PLACE');
    const [usps,geoid,officialName,,lat,lon]=matches[0],latitude=Number(Number(lat).toFixed(4)),longitude=Number(Number(lon).toFixed(4));
    return {input:location,official_name:officialName,state:usps,geoid,source_latitude:lat,source_longitude:lon,coordinates:latitude+','+longitude,latitude,longitude,coordinate_role:'Census internal point rounded to four decimals; not street location or exact-point weather',vintage:2026,source:structuredClone(source)};
  };
}
