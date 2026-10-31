// @ts-nocheck
// Only the goods package uses this bridge; keep it out of the main package.
import { loadServices } from '../../../common/services/client';
export const fetchGoodsList = (...args) => loadServices().then(api => api.productList.fetchGoodsList(...args));
