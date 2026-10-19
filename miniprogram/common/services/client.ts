import { createPackageLoader } from '../package-loader';
declare const require: { async(path: string): Promise<typeof import('../../services/index')> };
export const loadServices = createPackageLoader(() => require.async('../../services/index'));
