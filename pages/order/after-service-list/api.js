import {
  createMockResponse,
  getAfterServiceRecords,
  getAfterServiceStates,
} from '../../../model/order/afterService';

export function getRightsList({ parameter = {} } = {}) {
  const pageNum = Number(parameter.pageNum) || 1;
  const pageSize = Number(parameter.pageSize) || 10;
  const status = Number(parameter.afterServiceStatus);
  const records = getAfterServiceRecords();
  const filteredRecords =
    Number.isInteger(status) && status > -1
      ? records.filter((item) => item.rights.rightsStatus === status)
      : records;
  const start = (pageNum - 1) * pageSize;

  return Promise.resolve(
    createMockResponse({
      pageNum,
      pageSize,
      totalCount: filteredRecords.length,
      states: getAfterServiceStates(),
      dataList: filteredRecords.slice(start, start + pageSize),
    }),
  );
}
