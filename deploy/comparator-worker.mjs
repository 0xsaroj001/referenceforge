import module from './v2-public/referenceforge-comparator.wasm';
import {createComparatorExecutor} from '../src/comparator-runnable.mjs';
export default createComparatorExecutor(module);
