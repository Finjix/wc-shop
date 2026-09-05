/** 小程序启动和业务请求所需的轻量运行时配置。 */
export const config = {
  /**
   * 是否使用本地演示数据。
   * true：开发者工具直接使用 model/ 下的历史 mock；false：调用 CloudBase 云函数。
   */
  useMock: true,
  // 开发者工具默认使用本地 mock；联调 CloudBase 时改为 false。
  /** CloudBase 环境 ID；部署前填入开发者工具中显示的真实环境 ID。 */
  cloudEnvId: 'wc-shop-d8gx31ihpf0093259',
  /** 承载小程序与管理后台接口的统一云函数名称。 */
  cloudFunctionName: 'wc-shop-function',
};

export const cdnBase =
  'https://we-retail-static-1300977798.cos.ap-guangzhou.myqcloud.com/retail-mp';
