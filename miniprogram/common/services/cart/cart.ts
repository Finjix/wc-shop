// Service implementation: services/cart/cart.ts
// @ts-nocheck
// Async boundary: implementation and mutable service state live in services.
import { loadServices } from '../client';
export const fetchCartGroupData = (...args) => loadServices().then(api => api.cart.fetchCartGroupData(...args));
export const addGoodsToCart = (...args) => loadServices().then(api => api.cart.addGoodsToCart(...args));
export const updateCartItemSelection = (...args) => loadServices().then(api => api.cart.updateCartItemSelection(...args));
export const updateCartStoreSelection = (...args) => loadServices().then(api => api.cart.updateCartStoreSelection(...args));
export const updateAllCartSelection = (...args) => loadServices().then(api => api.cart.updateAllCartSelection(...args));
export const updateCartItemQuantity = (...args) => loadServices().then(api => api.cart.updateCartItemQuantity(...args));
export const replaceCartItemSku = (...args) => loadServices().then(api => api.cart.replaceCartItemSku(...args));
export const deleteCartItem = (...args) => loadServices().then(api => api.cart.deleteCartItem(...args));
export const clearInvalidCartItems = (...args) => loadServices().then(api => api.cart.clearInvalidCartItems(...args));
