// Premium: zakup jednorazowy przez Google Play Billing (Digital Goods API + Payment Request API).
// Działa tylko w aplikacji z Google Play. W przeglądarce i na iPhonie Premium jest niedostępne.
var Premium = (function () {
  var SKU = "premium_lifetime";                 // ID produktu w Play Console
  // Adres serwera, który potwierdza zakupy w Google (Cloudflare Worker). Bez potwierdzenia
  // Google zwraca pieniądze po 3 dniach, więc przed publikacją trzeba go uzupełnić.
  var VERIFY_URL = "";
  var BILLING = "https://play.google.com/billing";

  var state = { active: false, available: false, price: null, ready: false };
  var service = null, listeners = [];

  function save(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function emit() { listeners.forEach(function (fn) { try { fn(state); } catch (e) {} }); }
  function setActive(v) { state.active = !!v; save("sleepPremium", v ? "1" : "0"); emit(); }

  async function verify(token) {
    if (!VERIFY_URL) return true;
    try {
      var r = await fetch(VERIFY_URL, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token, sku: SKU })
      });
      var j = await r.json();
      return !!j.valid;
    } catch (e) {
      // No connection: unlock now; the purchase is checked again at the next start.
      return true;
    }
  }

  async function refresh() {
    if (!service) return false;
    var list = await service.listPurchases();
    var mine = list.filter(function (p) { return p.itemId === SKU; });
    setActive(mine.length > 0);
    mine.forEach(function (p) { verify(p.purchaseToken); }); // acknowledges purchases that are still pending
    return mine.length > 0;
  }

  async function init(lang) {
    // Local testing only: localhost with the debug flag behaves as if Premium was bought.
    if ((location.hostname === "localhost" || location.hostname === "127.0.0.1") && load("sleepPremiumDebug") === "1") {
      state.active = true; state.available = true; state.price = "29,99 zł"; state.ready = true; emit(); return;
    }
    if (!("getDigitalGoodsService" in window)) { state.ready = true; emit(); return; }
    // Inside the Play app: show the last known state right away, then confirm with Google Play.
    state.active = load("sleepPremium") === "1";
    try {
      service = await window.getDigitalGoodsService(BILLING);
      state.available = true;
      try {
        var details = await service.getDetails([SKU]);
        if (details && details[0]) {
          var pr = details[0].price;
          state.price = new Intl.NumberFormat(lang || navigator.language, { style: "currency", currency: pr.currency }).format(Number(pr.value));
        }
      } catch (e) {}
      try { await refresh(); } catch (e) {}
    } catch (e) {
      service = null; state.available = false;
    }
    state.ready = true;
    emit();
  }

  // Returns "ok", "cancel" or "error".
  async function buy() {
    if (!service) return "error";
    var request;
    try {
      request = new PaymentRequest(
        [{ supportedMethods: BILLING, data: { sku: SKU } }],
        { total: { label: "Total", amount: { currency: "USD", value: "0" } } }
      );
    } catch (e) { return "error"; }
    var response;
    try { response = await request.show(); }
    catch (e) { return "cancel"; }
    var ok = await verify(response.details && response.details.purchaseToken);
    try { await response.complete(ok ? "success" : "fail"); } catch (e) {}
    if (ok) setActive(true);
    return ok ? "ok" : "error";
  }

  async function restore() {
    try { return await refresh(); } catch (e) { return false; }
  }

  return {
    init: init, buy: buy, restore: restore,
    state: function () { return state; },
    onChange: function (fn) { listeners.push(fn); }
  };
})();
