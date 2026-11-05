import places from '../dist/census/us-places-2026.json';
import {createUSPlaceResolver} from '../src/us-place-resolver.mjs';
import {createV2Worker} from './v2-worker.mjs';
export default createV2Worker({locationResolver:createUSPlaceResolver(places)});
