/**
 * 테스트용 가짜 대상 사이트 (운영 코드 아님).
 *
 * target-site-contract.md의 조건을 최소로 흉내 낸다:
 * - 화면: ai/evals/corpus/catalog.json의 data-testid
 * - 업무 API: ai/evals/corpus/openapi.yaml (servers /api)
 * - 테스트 전용 API: POST /api/test/reset(데이터만, 장애 유지), GET·POST·DELETE /api/test/faults, GET /api/test/version,
 *   읽기 전용 조회 GET /api/test/query/cart-items, /api/test/query/orders (X-Test-Control-Token 필요)
 *
 * 수동 실행: `node --import tsx test/fixtures/target-site/server.ts [port]` (기본 4010)
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";

export const CONTROL_TOKEN = "test-control-token";
export const MEMBER = { email: "member@example.test", password: "test-password-1", name: "테스트 회원" };

/** 장애 주입 목록 (성공 기준 평가용). id → 효과 */
export const FAULTS = {
  "cart-total-ui-mismatch": "장바구니 화면 합계가 API 합계보다 1,000원 크다 (교차 검증 DATA_MISMATCH)",
  "cart-add-500": "장바구니 담기 API가 500을 돌려준다 (API_ERROR)",
  "cart-schema-break": "장바구니 API의 totalAmount가 문자열이다 (API_SCHEMA_MISMATCH)",
  "remove-button-missing": "장바구니 화면에 삭제 버튼이 없다 (ELEMENT_NOT_FOUND)",
  "qty-no-validation": "수량 100도 받아들인다 (경계값 케이스 실패)",
  "login-slow": "로그인 API가 20초 늦게 응답한다 (TIMEOUT)",
} as const;
export type FaultId = keyof typeof FAULTS;

interface Product { productId: number; name: string; price: number; stock: number }
interface CartItem { productId: number; quantity: number; price: number }
interface Order { orderId: string; status: "PAID" | "SHIPPING" | "DELIVERED" | "CANCELLED"; totalAmount: number }
interface State {
  products: Product[];
  carts: Map<string, CartItem[]>;
  orders: Map<string, Order[]>;
  members: Map<string, { password: string; name: string }>;
  sessions: Map<string, string>;
  faults: Set<FaultId>;
  orderSeq: number;
}

function seed(): State {
  return {
    products: [
      { productId: 1001, name: "무선 마우스", price: 25000, stock: 10 },
      { productId: 1002, name: "기계식 키보드", price: 59000, stock: 3 },
    ],
    carts: new Map([[MEMBER.email, [{ productId: 1001, quantity: 2, price: 25000 }]]]),
    orders: new Map([[MEMBER.email, [{ orderId: "ORD-0001", status: "PAID", totalAmount: 50000 }]]]),
    members: new Map([[MEMBER.email, { password: MEMBER.password, name: MEMBER.name }]]),
    sessions: new Map(),
    faults: new Set(),
    orderSeq: 1,
  };
}

const COUPONS = [{ couponId: "WELCOME5000", name: "가입 축하 5,000원", discountAmount: 5000, minOrderAmount: 30000, expiresAt: "2099-12-31" }];

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(title: string, body: string, script = ""): string {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)}</title></head>
<body><nav><a href="/products">상품</a> <a href="/cart">장바구니</a> <a href="/orders">주문</a></nav>
<h1>${esc(title)}</h1>${body}
<script>
async function api(method, path, body) {
  const res = await fetch('/api' + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}
${script}
</script></body></html>`;
}

export interface TargetSite {
  url: string;
  state: () => State;
  close: () => Promise<void>;
}

export async function startTargetSite(port = 0): Promise<TargetSite> {
  let state = seed();

  const send = (res: ServerResponse, status: number, data?: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
    res.end(data === undefined ? "" : JSON.stringify(data));
  };
  const html = (res: ServerResponse, body: string) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(body);
  };
  const readBody = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    try {
      return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };
  const member = (req: IncomingMessage): string | null => {
    const auth = req.headers.authorization;
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie ?? "")?.[1];
    return token ? (state.sessions.get(token) ?? null) : null;
  };
  const cartOf = (email: string) => state.carts.get(email) ?? [];
  const total = (items: CartItem[]) => items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const cartBody = (email: string) => {
    const items = cartOf(email);
    const t = total(items);
    return { items, totalAmount: state.faults.has("cart-schema-break") ? String(t) : t };
  };

  async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const p = url.pathname.slice(4); // "/api" 제거
    // 실제 서버처럼 약간의 응답 지연 (API 응답 시간 기록 확인용)
    await new Promise((r) => setTimeout(r, 15));
    const m = req.method ?? "GET";

    // --- 테스트 전용 API ---
    if (p.startsWith("/test/")) {
      if (req.headers["x-test-control-token"] !== CONTROL_TOKEN) return send(res, 401, { message: "토큰 필요" });
      if (p === "/test/reset" && m === "POST") {
        // 업무 데이터만 되돌리고 활성 장애는 그대로 둔다. 장애 해제는 DELETE /faults로만 (target-site-contract)
        const faults = state.faults;
        state = seed();
        state.faults = faults;
        return send(res, 200, { reset: true, faults: [...faults] });
      }
      if (p === "/test/faults" && m === "POST") {
        const { faultId } = await readBody(req);
        if (typeof faultId !== "string" || !(faultId in FAULTS)) return send(res, 400, { message: "모르는 장애" });
        state.faults.add(faultId as FaultId);
        return send(res, 200, { faults: [...state.faults] });
      }
      if (p === "/test/faults" && m === "GET") return send(res, 200, { faults: [...state.faults] });
      if (p === "/test/faults" && m === "DELETE") {
        state.faults.clear();
        return send(res, 200, { faults: [] });
      }
      if (p === "/test/version" && m === "GET") return send(res, 200, { build: "fixture1" });
      const email = url.searchParams.get("memberEmail") ?? "";
      if (p === "/test/query/cart-items" && m === "GET") return send(res, 200, cartOf(email));
      if (p === "/test/query/orders" && m === "GET") return send(res, 200, state.orders.get(email) ?? []);
      return send(res, 404, { message: "없는 경로" });
    }

    // --- 공개 API ---
    if (p === "/auth/login" && m === "POST") {
      const { email, password } = await readBody(req);
      if (state.faults.has("login-slow")) await new Promise((r) => setTimeout(r, 20_000));
      const found = typeof email === "string" ? state.members.get(email) : undefined;
      if (!found || found.password !== password) return send(res, 401, { message: "이메일 또는 비밀번호가 맞지 않아요" });
      const token = randomUUID();
      state.sessions.set(token, email as string);
      return send(res, 200, { accessToken: token }, { "set-cookie": `sid=${token}; Path=/; HttpOnly; SameSite=Lax` });
    }
    if (p === "/members" && m === "POST") {
      const { email, password, name } = await readBody(req);
      if (typeof email !== "string" || typeof password !== "string" || typeof name !== "string") return send(res, 400, {});
      if (password.length < 8 || password.length > 20) return send(res, 400, { message: "비밀번호는 8~20자" });
      if (state.members.has(email)) return send(res, 409, { message: "이미 가입한 이메일이에요" });
      state.members.set(email, { password, name });
      return send(res, 201, {});
    }
    if (p === "/products" && m === "GET") return send(res, 200, state.products);
    if (p === "/products/search" && m === "GET") {
      const q = url.searchParams.get("q") ?? "";
      if (q.length < 2 || q.length > 30) return send(res, 400, { message: "검색어는 2~30자" });
      return send(res, 200, state.products.filter((x) => x.name.includes(q)));
    }
    const productMatch = /^\/products\/(\d+)$/.exec(p);
    if (productMatch && m === "GET") {
      const product = state.products.find((x) => x.productId === Number(productMatch[1]));
      return product ? send(res, 200, product) : send(res, 404, { message: "없는 상품" });
    }

    // --- 로그인 필요 ---
    const email = member(req);
    if (!email) return send(res, 401, { message: "로그인이 필요해요" });

    if (p === "/cart" && m === "GET") return send(res, 200, cartBody(email));
    if (p === "/cart/items" && m === "POST") {
      if (state.faults.has("cart-add-500")) return send(res, 500, { message: "서버 오류" });
      const { productId, quantity } = await readBody(req);
      const product = state.products.find((x) => x.productId === Number(productId));
      const qty = Number(quantity);
      if (!product || !Number.isInteger(qty) || qty < 1 || qty > 99) return send(res, 400, { message: "잘못된 요청" });
      const items = cartOf(email);
      const existing = items.find((i) => i.productId === product.productId);
      const nextQty = (existing?.quantity ?? 0) + qty;
      if (nextQty > product.stock) return send(res, 409, { message: "재고가 부족해요" });
      if (existing) existing.quantity = nextQty;
      else items.push({ productId: product.productId, quantity: qty, price: product.price });
      state.carts.set(email, items);
      return send(res, 201, { productId: product.productId, quantity: nextQty, price: product.price });
    }
    const cartItem = /^\/cart\/items\/(\d+)$/.exec(p);
    if (cartItem && m === "PATCH") {
      const { quantity } = await readBody(req);
      const qty = Number(quantity);
      const max = state.faults.has("qty-no-validation") ? 1000 : 99;
      if (!Number.isInteger(qty) || qty < 1 || qty > max) return send(res, 400, { message: "수량은 1~99" });
      const item = cartOf(email).find((i) => i.productId === Number(cartItem[1]));
      if (!item) return send(res, 404, { message: "장바구니에 없는 상품" });
      item.quantity = qty;
      return send(res, 200, cartBody(email));
    }
    if (cartItem && m === "DELETE") {
      const items = cartOf(email);
      const idx = items.findIndex((i) => i.productId === Number(cartItem[1]));
      if (idx < 0) return send(res, 404, { message: "장바구니에 없는 상품" });
      items.splice(idx, 1);
      return send(res, 204);
    }
    if (p === "/orders" && m === "GET") return send(res, 200, state.orders.get(email) ?? []);
    if (p === "/orders/coupon-preview" && m === "POST") {
      const { couponId } = await readBody(req);
      const coupon = COUPONS.find((c) => c.couponId === couponId);
      const sum = total(cartOf(email));
      if (!coupon || sum < coupon.minOrderAmount) return send(res, 400, { message: "최소 주문 금액을 채워 주세요" });
      return send(res, 200, { totalAmount: sum - coupon.discountAmount });
    }
    if (p === "/orders" && m === "POST") {
      const { couponId } = await readBody(req);
      const sum = total(cartOf(email));
      const coupon = COUPONS.find((c) => c.couponId === couponId);
      if (couponId && (!coupon || sum < coupon.minOrderAmount)) return send(res, 400, { message: "최소 주문 금액을 채워 주세요" });
      state.orderSeq += 1;
      const order: Order = { orderId: `ORD-${String(state.orderSeq).padStart(4, "0")}`, status: "PAID", totalAmount: sum - (coupon?.discountAmount ?? 0) };
      state.orders.set(email, [...(state.orders.get(email) ?? []), order]);
      state.carts.set(email, []);
      return send(res, 201, order);
    }
    const cancel = /^\/orders\/([^/]+)\/cancel$/.exec(p);
    if (cancel && m === "POST") {
      const order = (state.orders.get(email) ?? []).find((o) => o.orderId === cancel[1]);
      if (!order) return send(res, 404, {});
      if (order.status !== "PAID") return send(res, 409, { message: "배송이 시작된 주문이에요" });
      order.status = "CANCELLED";
      return send(res, 200, order);
    }
    if (p === "/coupons" && m === "GET") return send(res, 200, COUPONS);
    const review = /^\/products\/(\d+)\/reviews$/.exec(p);
    if (review && m === "POST") {
      const { rating } = await readBody(req);
      if (!Number.isInteger(Number(rating)) || Number(rating) < 1 || Number(rating) > 5) return send(res, 400, {});
      return send(res, 201, {});
    }
    if (p === "/members/me/address" && m === "PUT") {
      const { zipCode } = await readBody(req);
      if (typeof zipCode !== "string" || !/^[0-9]{5}$/.test(zipCode)) return send(res, 400, { message: "우편번호 형식" });
      return send(res, 200, {});
    }
    return send(res, 404, { message: "없는 경로" });
  }

  function handlePage(res: ServerResponse, url: URL, email: string | null): void {
    const p = url.pathname;
    if (p === "/" || p === "/login") {
      return html(res, page("로그인", `
<input data-testid="login-email-input" type="email" placeholder="이메일">
<input data-testid="login-password-input" type="password" placeholder="비밀번호">
<button data-testid="login-submit-button">로그인</button>
<p data-testid="login-error-message" hidden></p>`, `
document.querySelector('[data-testid=login-submit-button]').onclick = async () => {
  const r = await api('POST', '/auth/login', { email: document.querySelector('[data-testid=login-email-input]').value, password: document.querySelector('[data-testid=login-password-input]').value });
  if (r.status === 200) { location.href = '/products'; return; }
  const m = document.querySelector('[data-testid=login-error-message]'); m.hidden = false; m.textContent = (r.data && r.data.message) || '로그인 실패';
};`));
    }
    if (p === "/signup") {
      return html(res, page("회원 가입", `
<input data-testid="signup-email-input"><input data-testid="signup-password-input" type="password"><input data-testid="signup-name-input">
<button data-testid="signup-submit-button">가입하기</button><p id="msg"></p>`, `
document.querySelector('[data-testid=signup-submit-button]').onclick = async () => {
  const v = (id) => document.querySelector('[data-testid=' + id + ']').value;
  const r = await api('POST', '/members', { email: v('signup-email-input'), password: v('signup-password-input'), name: v('signup-name-input') });
  document.getElementById('msg').textContent = r.status === 201 ? '가입했어요' : ((r.data && r.data.message) || '실패');
};`));
    }
    if (p === "/products") {
      // testId가 겹치면 getByTestId가 여러 요소를 찾으므로 첫 카드에만 붙인다
      const cards = state.products
        .map((x, i) => `<li><a ${i === 0 ? 'data-testid="product-card" ' : ""}href="/products/${x.productId}">${esc(x.name)} ${won(x.price)}</a></li>`)
        .join("");
      return html(res, page("상품 목록", `<ul data-testid="product-list">${cards}</ul>`));
    }
    const prod = /^\/products\/(\d+)$/.exec(p);
    if (prod) {
      const x = state.products.find((y) => y.productId === Number(prod[1]));
      if (!x) return html(res, page("상품 없음", "<p>없는 상품이에요</p>"));
      return html(res, page(x.name, `
<p>가격 <span data-testid="product-price">${won(x.price)}</span></p>
<p>재고 <span data-testid="product-stock">${x.stock}</span></p>
<input data-testid="product-qty-input" type="number" value="1">
<button data-testid="cart-add-button">장바구니 담기</button><p id="msg"></p>`, `
document.querySelector('[data-testid=cart-add-button]').onclick = async () => {
  const r = await api('POST', '/cart/items', { productId: ${x.productId}, quantity: Number(document.querySelector('[data-testid=product-qty-input]').value), price: ${x.price} });
  document.getElementById('msg').textContent = r.status === 201 ? '담았어요' : ((r.data && r.data.message) || '실패');
};`));
    }
    if (p === "/cart") {
      const items = email ? cartOf(email) : [];
      const shown = total(items) + (state.faults.has("cart-total-ui-mismatch") ? 1000 : 0);
      const rows = items.slice(0, 1).map((i) => `
<li>${i.productId} <input data-testid="cart-item-quantity" data-product="${i.productId}" type="number" value="${i.quantity}">
${state.faults.has("remove-button-missing") ? "" : `<button data-testid="cart-remove-button" data-product="${i.productId}">삭제</button>`}</li>`).join("");
      return html(res, page("장바구니", `<ul>${rows}</ul>
<p>합계 <span data-testid="cart-total-amount">${won(shown)}</span></p>
<button data-testid="cart-checkout-button">주문하기</button>`, `
const q = document.querySelector('[data-testid=cart-item-quantity]');
if (q) q.onchange = async () => { await api('PATCH', '/cart/items/' + q.dataset.product, { quantity: Number(q.value) }); location.reload(); };
const rm = document.querySelector('[data-testid=cart-remove-button]');
if (rm) rm.onclick = async () => { await api('DELETE', '/cart/items/' + rm.dataset.product); location.reload(); };
document.querySelector('[data-testid=cart-checkout-button]').onclick = () => { location.href = '/checkout'; };`));
    }
    if (p === "/checkout") {
      const sum = email ? total(cartOf(email)) : 0;
      return html(res, page("결제", `
<select data-testid="coupon-select"><option value="">쿠폰 없음</option>${COUPONS.map((c) => `<option value="${c.couponId}">${esc(c.name)}</option>`).join("")}</select>
<button data-testid="coupon-apply-button">쿠폰 적용</button>
<p data-testid="coupon-error-message"></p>
<p>결제 금액 <span data-testid="order-total-amount">${won(sum)}</span></p>
<button data-testid="order-pay-button">결제하기</button>`, `
const sel = () => document.querySelector('[data-testid=coupon-select]').value;
document.querySelector('[data-testid=coupon-apply-button]').onclick = async () => {
  const r = await api('POST', '/orders/coupon-preview', { couponId: sel() });
  if (r.status === 200) document.querySelector('[data-testid=order-total-amount]').textContent = r.data.totalAmount.toLocaleString('ko-KR') + '원';
  else document.querySelector('[data-testid=coupon-error-message]').textContent = r.data.message;
};
document.querySelector('[data-testid=order-pay-button]').onclick = async () => {
  const r = await api('POST', '/orders', { couponId: sel() || null });
  if (r.status === 201) location.href = '/orders/complete?no=' + r.data.orderId;
};`));
    }
    if (p === "/orders/complete") {
      return html(res, page("주문 완료", `<p>주문 번호 <span data-testid="order-number">${esc(url.searchParams.get("no") ?? "")}</span></p>`));
    }
    if (p === "/orders") {
      const orders = email ? (state.orders.get(email) ?? []) : [];
      const first = orders[orders.length - 1];
      return html(res, page("주문 내역", `<ul data-testid="order-history-list">${orders.map((o) => `<li>${o.orderId} ${won(o.totalAmount)}</li>`).join("")}</ul>
${first ? `<p>상태 <span data-testid="order-status">${first.status}</span></p><button data-testid="order-cancel-button" data-order="${first.orderId}">주문 취소</button>` : ""}`, `
const c = document.querySelector('[data-testid=order-cancel-button]');
if (c) c.onclick = async () => { const r = await api('POST', '/orders/' + c.dataset.order + '/cancel'); if (r.status === 200) location.reload(); };`));
    }
    if (p === "/search") {
      return html(res, page("검색", `<input data-testid="search-input"><button data-testid="search-submit-button">검색</button><ul data-testid="search-result-list"></ul>`, `
document.querySelector('[data-testid=search-submit-button]').onclick = async () => {
  const r = await api('GET', '/products/search?q=' + encodeURIComponent(document.querySelector('[data-testid=search-input]').value));
  document.querySelector('[data-testid=search-result-list]').innerHTML = r.status === 200 ? r.data.map((x) => '<li>' + x.name + '</li>').join('') : '<li>' + r.data.message + '</li>';
};`));
    }
    if (p === "/coupons") {
      return html(res, page("쿠폰", `<ul data-testid="coupon-list">${COUPONS.map((c) => `<li>${esc(c.name)}</li>`).join("")}</ul>`));
    }
    const rev = /^\/products\/(\d+)\/reviews\/new$/.exec(p);
    if (rev) {
      return html(res, page("리뷰 작성", `<input data-testid="review-rating-input" type="number"><textarea data-testid="review-content-input"></textarea><button data-testid="review-submit-button">등록</button><p id="msg"></p>`, `
document.querySelector('[data-testid=review-submit-button]').onclick = async () => {
  const r = await api('POST', '/products/${rev[1]}/reviews', { rating: Number(document.querySelector('[data-testid=review-rating-input]').value), content: document.querySelector('[data-testid=review-content-input]').value });
  document.getElementById('msg').textContent = String(r.status);
};`));
    }
    if (p === "/mypage/address") {
      return html(res, page("배송지", `<input data-testid="address-zip-input"><button data-testid="address-save-button">저장</button><p id="msg"></p>`, `
document.querySelector('[data-testid=address-save-button]').onclick = async () => {
  const r = await api('PUT', '/members/me/address', { zipCode: document.querySelector('[data-testid=address-zip-input]').value, address: '서울', phone: '010' });
  document.getElementById('msg').textContent = String(r.status);
};`));
    }
    res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
    res.end(page("없는 화면", "<p>없는 화면이에요</p>"));
  }

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const run = url.pathname.startsWith("/api/") ? handleApi(req, res, url) : Promise.resolve(handlePage(res, url, member(req)));
    run.catch((err: unknown) => {
      if (!res.headersSent) send(res, 500, { message: String(err) });
    });
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    state: () => state,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const site = await startTargetSite(Number(process.argv[2] ?? 4010));
  console.log(`가짜 대상 사이트: ${site.url} (control token: ${CONTROL_TOKEN}, 계정 ${MEMBER.email} / ${MEMBER.password})`);
}
