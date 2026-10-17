import { createPackageLoader } from '../../common/package-loader';
declare const require: { async(path: string): Promise<typeof import('../api/index')> };
export const loadApi = createPackageLoader(() => require.async('../api/index'));
