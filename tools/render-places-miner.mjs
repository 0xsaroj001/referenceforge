import {v2Descriptor,v2ContractManifest,V2_ORIGIN} from './render-v2-miner.mjs';
export {V2_ORIGIN};
export function placesDescriptor(){
  const d=v2Descriptor();d.description='Original source-backed V2 subset. Weather accepts coordinates or exact 2026 Census US place name plus explicit state, with disclosed internal reference point. US NWS coverage and 1..48 hour forecast limits remain; no fuzzy place, street or global coverage.';
  for(const path of ['/v2/weather/current','/v2/weather/forecast']){
    const e=d.endpoints.find(x=>x.path===path);
    e.description=path.endsWith('/current')?'Recent actual NWS station temperature within 50 km and 90 minutes. Supply coordinates or exact Census place name plus state (example Miami, FL). Ambiguous/unknown names refused. Named-place coordinates are a disclosed Census internal reference point, not exact city-wide or street weather.':'Complete 1..48 future hourly NWS window at coordinates or an exact Census US place name plus state. Named places use a disclosed internal reference point. Ambiguous/unknown names, windows49..240 and incomplete precipitation refused. Precipitation is maximum hourly probability, not whole-window event probability.';
    e.params.query.required.find(p=>p.name==='location').description='Latitude,longitude with up to four decimals OR exact 2026 Census place name, US state abbreviation/full state name. Example: Miami, Florida. State is mandatory. Unknown or ambiguous names refused; no fuzzy match, street address, global city search or popularity guessing.';
  }
  return d;
}
export function placesContractManifest(){
  const m=v2ContractManifest();m.version='0.7.0';m.status='places_release_candidate';
  m.location_resolution={data_vintage:2026,source:'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2026_Gazetteer/2026_Gaz_place_national.zip',source_zip_sha256:'af678e2d990827c89ee39b98c82de6e90b693c7361ff0e559ae3076670dd2863',prepared_data_sha256:'7ca6c01a06552fdfb0844973c8a18c48f107ca399d9a4a71412dfbf33a34e826',matching:'Exact normalized name and explicit state. Ambiguity refuses.',coordinate_role:'Census internal point rounded to four decimals. Not a street location, population centroid or city-wide weather measurement.'};
  const d=placesDescriptor();for(const c of m.contracts)c.coverage=d.endpoints.find(e=>e.path===c.endpoint).description;return m;
}
