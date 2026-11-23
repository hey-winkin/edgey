export const receiveDeliveryHref = "/admin/stock/receive";
export const standaloneDeliveryHref = `${receiveDeliveryHref}?view=standalone`;

export function purchaseReceiptHref(id: string) {
  return `${receiveDeliveryHref}?po=${id}`;
}
