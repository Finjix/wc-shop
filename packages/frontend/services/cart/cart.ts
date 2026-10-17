// @ts-nocheck
// Async boundary: implementation and mutable service state live in api.
import { loadApi } from '../../api-client';
export const fetchCartGroupData = (...args) => loadApi().then(api => api.cart.fetchCartGroupData(...args));
export const addGoodsToCart = (...args) => loadApi().then(api => api.cart.addGoodsToCart(...args));
export const updateCartItemSelection = (...args) => loadApi().then(api => api.cart.updateCartItemSelection(...args));
export const updateCartStoreSelection = (...args) => loadApi().then(api => api.cart.updateCartStoreSelection(...args));
export const updateAllCartSelection = (...args) => loadApi().then(api => api.cart.updateAllCartSelection(...args));
export const updateCartItemQuantity = (...args) => loadApi().then(api => api.cart.updateCartItemQuantity(...args));
export const replaceCartItemSku = (...args) => loadApi().then(api => api.cart.replaceCartItemSku(...args));
export const deleteCartItem = (...args) => loadApi().then(api => api.cart.deleteCartItem(...args));
export const clearInvalidCartItems = (...args) => loadApi().then(api => api.cart.clearInvalidCartItems(...args));
