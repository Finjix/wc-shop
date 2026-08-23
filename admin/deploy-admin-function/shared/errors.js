class AppError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }
}

const ERRORS = Object.freeze({
  INVALID_ARGUMENT: ['INVALID_ARGUMENT', '请求参数无效'],
  UNAUTHENTICATED: ['UNAUTHENTICATED', '请先完成登录'],
  FORBIDDEN: ['FORBIDDEN', '没有执行该操作的权限'],
  NOT_FOUND: ['NOT_FOUND', '请求的数据不存在'],
  CONFLICT: ['CONFLICT', '数据已发生变化，请刷新后重试'],
  OUT_OF_STOCK: ['OUT_OF_STOCK', '商品库存不足'],
  SKU_UNAVAILABLE: ['SKU_UNAVAILABLE', '商品规格已下架或不存在'],
  ORDER_STATE_INVALID: ['ORDER_STATE_INVALID', '订单当前状态不允许此操作'],
  IDEMPOTENCY_CONFLICT: ['IDEMPOTENCY_CONFLICT', '该请求正在处理或已使用不同参数提交'],
  DATABASE_ERROR: ['DATABASE_ERROR', '数据服务暂时不可用'],
  STORAGE_ERROR: ['STORAGE_ERROR', '文件服务暂时不可用'],
  INTERNAL_ERROR: ['INTERNAL_ERROR', '服务暂时不可用'],
});

function errorFrom(code, details) {
  const tuple = ERRORS[code] || ERRORS.INTERNAL_ERROR;
  return new AppError(tuple[0], tuple[1], details);
}

function isNotFound(error) {
  const text = `${error && error.code ? error.code : ''} ${error && error.message ? error.message : ''}`.toLowerCase();
  return text.includes('not found') || text.includes('not_found') || text.includes('document does not exist');
}

function isWriteConflict(error) {
  const text = `${error && error.code ? error.code : ''} ${error && error.message ? error.message : ''}`.toLowerCase();
  return text.includes('conflict') || text.includes('write conflict') || text.includes('transaction');
}

function toPublicError(error) {
  if (error instanceof AppError) return error;
  if (isNotFound(error)) return errorFrom('NOT_FOUND');
  if (isWriteConflict(error)) return errorFrom('CONFLICT');
  return errorFrom('INTERNAL_ERROR');
}

module.exports = { AppError, ERRORS, errorFrom, isNotFound, isWriteConflict, toPublicError };
