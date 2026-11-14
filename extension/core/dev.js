// Development only: a made-up product whose price changes every minute, for
// trying out notifications. Release builds replace this file with
// release/dev.js (see the "package:ext" script), so it never ships.

export const DEV_TEST = {
  url: "https://example.com/dip-test-product",

  /** A new price, never the same as `last`. @param {number} [last] */
  found(last) {
    let price;
    do price = Math.round(4000 + Math.random() * 2000) / 100;
    while (price === last);
    return {
      price,
      currency: "USD",
      title: "Test product",
      image: null,
      icon: null,
      available: null,
      source: /** @type {const} */ ("data"),
    };
  },
};
