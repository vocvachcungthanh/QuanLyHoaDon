/**
 * app.js — Logic chính của ứng dụng Quản Lý Hóa Đơn
 * Yêu cầu: env.js (chứa SUPABASE_URL, SUPABASE_ANON_KEY) được load trước file này
 */

/* ============================================================
   THEME — Chế độ sáng / tối
============================================================ */

/**
 * Chuyển đổi giữa theme sáng (light) và tối (dark).
 * Lưu lựa chọn vào localStorage để nhớ khi reload trang.
 */
function toggleTheme() {
  const html    = document.documentElement
  const isLight = html.getAttribute('data-theme') === 'light'
  const next    = isLight ? 'dark' : 'light'
  html.setAttribute('data-theme', next)
  localStorage.setItem('theme', next)
  updateThemeIcons(next)
}

/**
 * Cập nhật icon mặt trăng / mặt trời trên nút toggle theme.
 * @param {string} theme - 'light' hoặc 'dark'
 */
function updateThemeIcons(theme) {
  const moon = document.getElementById('theme-icon-moon')
  const sun  = document.getElementById('theme-icon-sun')
  if (!moon || !sun) return
  moon.classList.toggle('hidden', theme === 'light')
  sun.classList.toggle('hidden',  theme === 'dark')
}

// Áp dụng theme đã lưu ngay khi script chạy (trước khi DOM render xong)
// để tránh nhấp nháy khi chuyển theme
;(function initTheme() {
  const saved = localStorage.getItem('theme') || 'dark'
  document.documentElement.setAttribute('data-theme', saved)
  // Cập nhật icon sau khi DOM đã sẵn sàng
  window.addEventListener('DOMContentLoaded', () => updateThemeIcons(saved))
})()


/* ============================================================
   CẤU HÌNH & KHỞI TẠO SUPABASE
============================================================ */

// Mảng màu dùng để phân biệt các nơi mua trong biểu đồ và danh sách
const LOC_COLORS = ['#f59e0b','#3b82f6','#8b5cf6','#ec4899','#14b8a6','#f97316','#06b6d4','#84cc16']

// Kiểm tra xem người dùng đã điền thông tin Supabase vào env.js chưa
const isConfigured = SUPABASE_URL !== 'YOUR_SUPABASE_URL' && SUPABASE_ANON_KEY !== 'YOUR_SUPABASE_ANON_KEY'
if (!isConfigured) document.getElementById('config-banner').classList.remove('hidden')

// Tạo client Supabase — dùng để gọi database và authentication
const db = isConfigured ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null


/* ============================================================
   TRẠNG THÁI TOÀN CỤC (Global State)
============================================================ */

let items       = []           // Danh sách hóa đơn đang hiển thị
let brands      = []           // Danh sách thương hiệu giá vàng
let messages    = []           // Danh sách tin nhắn nhóm
let currentUser = null         // Thông tin user đang đăng nhập
let activeTab   = 'dashboard'  // Tab đang mở: 'dashboard' | 'invoices' | 'prices' | 'messages'
let sortField   = 'created_at' // Cột đang sắp xếp trong bảng hóa đơn
let sortDir     = 'desc'       // Chiều sắp xếp: 'asc' (tăng) | 'desc' (giảm)
let editingId   = null         // ID hóa đơn đang chỉnh sửa (null = đang thêm mới)
let activeCat   = null         // Danh mục đang xem trong tab hóa đơn (null = xem tất cả danh mục)


/* ============================================================
   TIỆN ÍCH (Utils)
============================================================ */

/**
 * Định dạng số thành chuỗi tiền tệ VNĐ.
 * Ví dụ: 16970000 → "16.970.000 ₫"
 */
const fmt = v => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(v || 0)

/**
 * Rút gọn số thành dạng triệu (M).
 * Ví dụ: 16970000 → "16.97M"
 */
const fmtM = v => ((v || 0) / 1e6).toFixed(2) + 'M'

/**
 * Lấy danh sách các nơi mua duy nhất từ danh sách hóa đơn hiện tại.
 */
const locations = () => [...new Set(items.map(i => i.location))]

/**
 * Trả về màu sắc đại diện cho một nơi mua cụ thể.
 * Màu được chọn theo vị trí trong mảng LOC_COLORS, lặp lại nếu vượt quá.
 * @param {string} loc - Tên nơi mua
 */
const locColor = loc => LOC_COLORS[locations().indexOf(loc) % LOC_COLORS.length]

/**
 * Cập nhật chỉ báo trạng thái kết nối Supabase ở sidebar.
 * @param {boolean} ok  - true = kết nối thành công, false = lỗi
 * @param {string}  msg - Nội dung trạng thái hiển thị
 */
function setDbStatus(ok, msg) {
  const dot = document.getElementById('db-dot')
  const txt = document.getElementById('db-status')
  dot.className = `w-1.5 h-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-red-500'}`
  txt.textContent = msg
}


/* ============================================================
   THÔNG BÁO NỔI (Toast Notification)
============================================================ */

/**
 * Hiển thị thông báo nổi góc phải màn hình trong 3 giây.
 * @param {string} msg  - Nội dung thông báo
 * @param {string} type - 'success' (xanh lá) hoặc 'error' (đỏ)
 */
function showToast(msg, type = 'success') {
  const t = document.getElementById('toast')
  t.className = `fixed bottom-6 right-6 z-[100] flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl text-sm font-medium text-white toast-enter ${type === 'success' ? 'bg-emerald-500' : 'bg-red-500'}`
  t.innerHTML = type === 'success'
    ? `<svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>${msg}`
    : `<svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>${msg}`
  clearTimeout(t._timer)
  t._timer = setTimeout(() => t.classList.add('hidden'), 3000)
}


/* ============================================================
   SUPABASE — TẢI DỮ LIỆU
============================================================ */

/**
 * Tải toàn bộ dữ liệu (hóa đơn + thương hiệu) từ Supabase.
 * Được gọi sau khi đăng nhập thành công.
 */
async function loadAll() {
  if (!isConfigured) { setDbStatus(false, 'Chưa cấu hình'); return }
  try {
    await Promise.all([loadItems(), loadBrands(), loadMessages()])
    setDbStatus(true, 'Đã kết nối')
    renderDashboard()
  } catch (e) {
    setDbStatus(false, 'Lỗi kết nối')
  }
}


/* ============================================================
   SIDEBAR MOBILE — Mở / đóng thanh điều hướng bên trái
============================================================ */

/**
 * Bật / tắt hiển thị sidebar trên mobile.
 * Sidebar trượt vào/ra từ bên trái, kèm overlay tối phía sau.
 */
function toggleSidebar() {
  const sb   = document.getElementById('sidebar')
  const ov   = document.getElementById('sidebar-overlay')
  const open = !sb.classList.contains('-translate-x-full')
  if (open) {
    // Đóng sidebar
    sb.classList.add('-translate-x-full')
    ov.classList.add('opacity-0')
    setTimeout(() => ov.classList.add('hidden'), 280)
  } else {
    // Mở sidebar
    ov.classList.remove('hidden')
    requestAnimationFrame(() => ov.classList.remove('opacity-0'))
    sb.classList.remove('-translate-x-full')
  }
}

/**
 * Đóng sidebar (dùng khi nhấn vào overlay hoặc chọn tab).
 */
function closeSidebar() {
  const sb = document.getElementById('sidebar')
  const ov = document.getElementById('sidebar-overlay')
  sb.classList.add('-translate-x-full')
  ov.classList.add('opacity-0')
  setTimeout(() => ov.classList.add('hidden'), 280)
}


/* ============================================================
   ĐIỀU HƯỚNG TAB — Chuyển giữa Tổng quan / Hóa đơn / Thương hiệu
============================================================ */

/**
 * Chuyển sang tab được chọn, cập nhật trạng thái active của
 * sidebar nav và bottom nav, sau đó render nội dung tương ứng.
 * @param {string} tab - 'dashboard' | 'invoices' | 'prices'
 */
function switchTab(tab) {
  activeTab = tab
  closeSidebar()
  const titles = { dashboard: 'Tổng quan', invoices: 'Hóa đơn', prices: 'Giá thương hiệu', messages: 'Tin nhắn' }

  ;['dashboard', 'invoices', 'prices', 'messages'].forEach(t => {
    // Ẩn/hiện nội dung tab
    document.getElementById(`tab-${t}`).classList.toggle('hidden', t !== tab)

    // Cập nhật màu nút sidebar nav
    const btn = document.getElementById(`nav-${t}`)
    btn.className = t === tab
      ? 'nav-btn w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all text-left bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'
      : 'nav-btn w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all text-left text-slate-400 hover:bg-slate-800 hover:text-white border border-transparent'

    // Cập nhật màu nút bottom nav (mobile)
    const bnav = document.getElementById(`bnav-${t}`)
    if (bnav) bnav.className = `bnav flex-1 flex flex-col items-center justify-center py-3 gap-0.5 transition-colors ${t === tab ? 'text-yellow-400' : 'text-slate-500'}`
  })

  document.getElementById('page-title').textContent = titles[tab]

  // Render nội dung phù hợp với tab được chọn
  if (tab === 'dashboard') renderDashboard()
  if (tab === 'invoices')  backToCategories()
  if (tab === 'prices')    renderPricesTab()
  if (tab === 'messages')  { markMessagesRead(); renderMessagesTab() }
}


/* ============================================================
   TỔNG QUAN (Dashboard)
============================================================ */

/**
 * Render toàn bộ trang Tổng quan:
 * - 4 thẻ thống kê tổng (số mục, dự tính bán, giá mua, lợi nhuận)
 * - Biểu đồ thanh theo nơi mua
 * - Danh sách thẻ giá thương hiệu
 * - Bảng / danh sách hóa đơn gần đây (6 cái mới nhất)
 */
function renderDashboard() {
  // --- Tính tổng các chỉ số ---
  const totalQty  = items.reduce((s, i) => s + Number(i.quantity),   0)
  const totalSell = items.reduce((s, i) => s + Number(i.sell_price), 0)
  const totalBuy  = items.reduce((s, i) => s + Number(i.buy_price),  0)
  const profit    = totalSell - totalBuy
  const rate      = totalBuy > 0 ? ((profit / totalBuy) * 100).toFixed(1) : '0.0'

  // Cập nhật 4 thẻ thống kê
  document.getElementById('stat-qty').textContent     = totalQty
  document.getElementById('stat-qty-sub').textContent = `${items.length} hóa đơn · ${totalQty} chỉ`
  document.getElementById('stat-sell').textContent    = fmt(totalSell)
  document.getElementById('stat-buy').textContent     = fmt(totalBuy)
  document.getElementById('stat-profit').textContent  = fmt(profit)
  document.getElementById('stat-rate').innerHTML      = `Tỷ lệ: <span class="text-emerald-400 font-semibold">${rate}%</span>`

  // --- Biểu đồ phân tích theo nơi mua ---
  // Gom nhóm hóa đơn theo nơi mua, tính tổng số lượng / giá mua / dự tính bán
  const locStats = {}
  items.forEach(i => {
    if (!locStats[i.location]) locStats[i.location] = { count: 0, qty: 0, sell: 0, buy: 0 }
    locStats[i.location].count++
    locStats[i.location].qty  += Number(i.quantity)
    locStats[i.location].sell += Number(i.sell_price)
    locStats[i.location].buy  += Number(i.buy_price)
  })

  document.getElementById('location-chart').innerHTML = Object.entries(locStats).map(([loc, s]) => {
    const pct     = totalBuy > 0 ? (s.buy / totalBuy * 100) : 0
    const lprofit = s.sell - s.buy
    const col     = locColor(loc)
    return `<div>
      <div class="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 mb-1.5">
        <span class="text-slate-300 text-xs font-medium">${loc}</span>
        <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          <span class="text-slate-400">${s.count} HĐ · ${s.qty}chỉ</span>
          <span class="text-yellow-400 font-semibold">${fmt(s.buy)}</span>
          <span class="${lprofit >= 0 ? 'text-emerald-400' : 'text-red-400'} font-semibold">${lprofit >= 0 ? '+' : ''}${fmt(lprofit)}</span>
        </div>
      </div>
      <div class="h-2 bg-slate-800 rounded-full overflow-hidden">
        <div class="h-full rounded-full bar" style="width:${pct}%;background:${col}"></div>
      </div>
    </div>`
  }).join('') || '<p class="text-slate-500 text-xs">Chưa có dữ liệu</p>'

  // --- Thẻ giá thương hiệu trong dashboard ---
  document.getElementById('brand-cards-dash').innerHTML = brands.map(b => `
    <div class="p-3 bg-slate-800/60 rounded-xl border border-slate-700/50">
      <div class="flex items-center justify-between gap-2 mb-1.5">
        <span class="text-white font-semibold text-xs truncate">${b.name}</span>
        <span class="px-2 py-0.5 bg-yellow-500/15 text-yellow-400 text-xs font-bold rounded border border-yellow-500/20 flex-shrink-0">${b.code || b.name}</span>
      </div>
      <div class="text-yellow-400 font-bold text-sm">${fmt(b.price)}</div>
    </div>`).join('')

  // --- Giá thương hiệu mini ở cuối sidebar ---
  document.getElementById('sidebar-prices').innerHTML = brands.map(b => `
    <div class="flex items-center justify-between px-3 py-2 bg-slate-800/60 rounded-lg gap-2">
      <span class="text-xs font-bold text-slate-300">${b.code || b.name}</span>
      <span class="text-xs font-bold text-yellow-400">${fmt(b.price)}</span>
    </div>`).join('')

  // --- Hóa đơn gần đây (6 cái mới nhất) ---
  const recentItems = items.slice(0, 6)

  // Bảng desktop
  document.getElementById('recent-rows').innerHTML = recentItems.map(i => {
    const lp = Number(i.sell_price) - Number(i.buy_price)
    return `<tr class="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
      <td class="py-3 text-slate-300 pr-4">${i.location}</td>
      <td class="py-3 text-right text-slate-400 pr-4">${i.quantity} chỉ</td>
      <td class="py-3 text-right text-yellow-400 pr-4">${fmt(i.sell_price)}</td>
      <td class="py-3 text-right text-slate-300 pr-4">${fmt(i.buy_price)}</td>
      <td class="py-3 text-right font-semibold ${lp >= 0 ? 'text-emerald-400' : 'text-red-400'}">${lp >= 0 ? '+' : ''}${fmt(lp)}</td>
    </tr>`
  }).join('') || '<tr><td colspan="5" class="py-6 text-center text-slate-500">Chưa có hóa đơn</td></tr>'

  // Thẻ mobile (ẩn trên màn hình >= sm)
  const recentMob = document.getElementById('recent-cards-mobile')
  if (recentMob) {
    recentMob.innerHTML = recentItems.map(i => {
      const lp = Number(i.sell_price) - Number(i.buy_price)
      return `<div class="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div class="flex items-center gap-2 mb-3">
          <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:${locColor(i.location)}"></span>
          <span class="text-white font-semibold text-sm truncate">${i.location}</span>
        </div>
        <div class="space-y-1.5">
          <div class="flex items-center justify-between bg-slate-800/60 rounded-lg px-3 py-2">
            <div class="text-xs text-slate-500">Số lượng</div>
            <div class="text-white font-semibold text-xs">${i.quantity} ${i.unit || 'chỉ'}</div>
          </div>
          <div class="flex items-center justify-between bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-3 py-2">
            <div class="text-xs text-slate-500">Dự tính bán</div>
            <div class="text-yellow-400 font-bold text-xs">${fmt(i.sell_price)}</div>
          </div>
          <div class="flex items-center justify-between bg-slate-800/60 rounded-lg px-3 py-2">
            <div class="text-xs text-slate-500">Giá mua</div>
            <div class="text-slate-300 font-semibold text-xs">${fmt(i.buy_price)}</div>
          </div>
          <div class="flex items-center justify-between px-1 pt-0.5">
            <span class="text-xs text-slate-500">Lợi nhuận</span>
            <span class="text-sm font-bold ${lp >= 0 ? 'text-emerald-400' : 'text-red-400'}">${lp >= 0 ? '+' : ''}${fmt(lp)}</span>
          </div>
        </div>
      </div>`
    }).join('') || '<div class="py-4 text-center text-slate-500 text-xs">Chưa có hóa đơn</div>'
  }
}


/* ============================================================
   HÓA ĐƠN — Danh mục & Bảng
============================================================ */

/**
 * Màu sắc và icon cho từng danh mục hóa đơn.
 * Mỗi danh mục có bộ class Tailwind riêng để tạo giao diện khác nhau.
 */
const CAT_COLORS = {
  'Vàng':      { bg: 'bg-yellow-500/15', text: 'text-yellow-400',  border: 'border-yellow-500/20',  grad: 'from-yellow-500/10 to-yellow-600/5',  icon: '✦', ring: 'border-yellow-500/30' },
  'Bạc':       { bg: 'bg-slate-400/15',  text: 'text-slate-300',   border: 'border-slate-400/20',   grad: 'from-slate-400/10 to-slate-500/5',    icon: '◈', ring: 'border-slate-400/30' },
  'Kim cương': { bg: 'bg-blue-500/15',   text: 'text-blue-400',    border: 'border-blue-500/20',    grad: 'from-blue-500/10 to-blue-600/5',      icon: '◆', ring: 'border-blue-500/30'  },
  'Đá quý':    { bg: 'bg-purple-500/15', text: 'text-purple-400',  border: 'border-purple-500/20',  grad: 'from-purple-500/10 to-purple-600/5',  icon: '❋', ring: 'border-purple-500/30' },
}

/**
 * Lấy style của danh mục — nếu không có trong CAT_COLORS thì dùng style mặc định.
 * @param {string} cat - Tên danh mục
 */
function catStyle(cat) {
  return CAT_COLORS[cat] || {
    bg: 'bg-slate-600/20', text: 'text-slate-300', border: 'border-slate-500/20',
    grad: 'from-slate-600/10 to-slate-700/5', icon: '●', ring: 'border-slate-500/30'
  }
}

/**
 * Render lưới thẻ danh mục (màn hình Hóa đơn → view mặc định).
 * Mỗi thẻ hiển thị tổng số hóa đơn, dự tính bán, giá mua và lợi nhuận theo danh mục.
 */
function renderCategories() {
  // Gom nhóm hóa đơn theo danh mục
  const catMap = {}
  items.forEach(i => {
    const cat = i.danh_muc || 'Vàng'
    if (!catMap[cat]) catMap[cat] = { count: 0, qty: 0, sell: 0, buy: 0 }
    catMap[cat].count++
    catMap[cat].qty  += Number(i.quantity)
    catMap[cat].sell += Number(i.sell_price)
    catMap[cat].buy  += Number(i.buy_price)
  })

  document.getElementById('cat-cards').innerHTML = Object.entries(catMap).map(([cat, s]) => {
    const cs     = catStyle(cat)
    const profit = s.sell - s.buy
    const rate   = s.buy > 0 ? ((profit / s.buy) * 100).toFixed(1) : '0.0'
    const pColor = profit >= 0 ? 'text-emerald-400' : 'text-red-400'
    const pBg    = profit >= 0 ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-red-500/10 border-red-500/20'
    return `
    <button onclick="openCategory('${cat.replace(/'/g, "\\'")}')"
      class="text-left bg-slate-900 border ${cs.ring} rounded-2xl p-6 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 relative overflow-hidden group">
      <div class="absolute inset-0 bg-gradient-to-br ${cs.grad} pointer-events-none"></div>
      <div class="relative">
        <div class="flex items-start justify-between mb-4">
          <div>
            <div class="text-2xl mb-1 ${cs.text}">${cs.icon}</div>
            <div class="text-white font-bold text-xl">${cat}</div>
            <div class="text-slate-400 text-xs mt-1">${s.count} hóa đơn · ${s.qty} đơn vị</div>
          </div>
          <div class="w-8 h-8 rounded-lg ${cs.bg} border ${cs.border} flex items-center justify-center flex-shrink-0 mt-1">
            <svg class="w-4 h-4 ${cs.text}" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
            </svg>
          </div>
        </div>
        <div class="space-y-2">
          <div class="flex justify-between items-center">
            <span class="text-xs text-slate-500">Dự tính bán</span>
            <span class="text-xs font-semibold text-yellow-400">${fmt(s.sell)}</span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-xs text-slate-500">Giá mua</span>
            <span class="text-xs font-semibold text-white">${fmt(s.buy)}</span>
          </div>
          <div class="h-px bg-slate-800 my-1"></div>
          <div class="flex justify-between items-center">
            <span class="text-xs text-slate-500">Lợi nhuận</span>
            <span class="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-md border ${pBg} ${pColor}">
              ${profit >= 0 ? '+' : ''}${fmt(profit)}
              <span class="opacity-70">(${rate}%)</span>
            </span>
          </div>
        </div>
        <div class="mt-4 flex items-center gap-1 text-xs ${cs.text} opacity-0 group-hover:opacity-100 transition-opacity">
          Xem hóa đơn
          <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/>
          </svg>
        </div>
      </div>
    </button>`
  }).join('') || `<div class="col-span-3 py-20 text-center text-slate-500">Chưa có hóa đơn nào</div>`
}

/**
 * Mở bảng hóa đơn của một danh mục cụ thể.
 * Ẩn màn hình lưới danh mục, hiện bảng + breadcrumb.
 * @param {string} cat - Tên danh mục cần xem
 */
function openCategory(cat) {
  activeCat = cat
  document.getElementById('view-categories').classList.add('hidden')
  document.getElementById('view-table').classList.remove('hidden')
  const cs = catStyle(cat)
  document.getElementById('active-cat-label').innerHTML =
    `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border ${cs.bg} ${cs.text} ${cs.border}">${cs.icon} ${cat}</span>`
  document.getElementById('search-input').value = ''
  renderTable()
}

/**
 * Quay về màn hình lưới danh mục từ bảng hóa đơn chi tiết.
 * Reset activeCat về null.
 */
function backToCategories() {
  activeCat = null
  document.getElementById('view-table').classList.add('hidden')
  document.getElementById('view-categories').classList.remove('hidden')
  renderCategories()
}

/**
 * Render bảng hóa đơn (desktop) và danh sách thẻ (mobile).
 * Lọc theo danh mục đang chọn, từ khóa tìm kiếm và nơi mua.
 * Cũng render footer tổng cộng ở cả hai chế độ.
 */
function renderTable() {
  const q    = (document.getElementById('search-input').value || '').toLowerCase()
  const locF = document.getElementById('filter-loc').value

  // Cập nhật dropdown lọc nơi mua chỉ hiển thị các nơi mua trong danh mục đang xem
  const catItems = activeCat ? items.filter(i => (i.danh_muc || 'Vàng') === activeCat) : items
  const catLocs  = [...new Set(catItems.map(i => i.location))]
  const sel = document.getElementById('filter-loc')
  const cur = sel.value
  sel.innerHTML = '<option value="">Tất cả nơi mua</option>' +
    catLocs.map(l => `<option value="${l}" ${l === cur ? 'selected' : ''}>${l}</option>`).join('')

  // Lọc dữ liệu theo danh mục, từ khóa, nơi mua
  let result = activeCat ? items.filter(i => (i.danh_muc || 'Vàng') === activeCat) : [...items]
  if (q)    result = result.filter(i => i.location.toLowerCase().includes(q))
  if (locF) result = result.filter(i => i.location === locF)

  // Sắp xếp theo cột đang chọn
  result.sort((a, b) => {
    const av  = a[sortField] ?? '', bv = b[sortField] ?? ''
    const cmp = typeof av === 'string' ? av.localeCompare(bv) : Number(av) - Number(bv)
    return sortDir === 'asc' ? cmp : -cmp
  })

  document.getElementById('table-count').textContent = `${result.length} hóa đơn`

  // --- Render hàng bảng desktop ---
  const rowHTML = (item, idx) => {
    const lp = Number(item.sell_price) - Number(item.buy_price)
    return `<tr class="data-row border-b border-slate-800/60 hover:bg-slate-800/30 transition-colors">
      <td class="px-4 py-3.5 text-slate-500 text-xs">${idx + 1}</td>
      <td class="px-4 py-3.5">
        <div class="flex items-center gap-2">
          <span class="w-2 h-2 rounded-full flex-shrink-0" style="background:${locColor(item.location)}"></span>
          <span class="text-white font-medium truncate">${item.location}</span>
        </div>
      </td>
      <td class="px-4 py-3.5 text-right text-slate-300">${item.quantity} ${item.unit || 'chỉ'}</td>
      <td class="px-4 py-3.5 text-right text-yellow-400 font-medium">${fmt(item.sell_price)}</td>
      <td class="px-4 py-3.5 text-right text-slate-300">${fmt(item.buy_price)}</td>
      <td class="px-4 py-3.5 text-right font-semibold ${lp >= 0 ? 'text-emerald-400' : 'text-red-400'}">${lp >= 0 ? '+' : ''}${fmt(lp)}</td>
      <td class="px-4 py-3.5">
        <div class="row-actions flex items-center justify-center gap-1.5">
          <button onclick="openModal(${item.id})" class="p-1.5 rounded-lg bg-slate-700 hover:bg-yellow-500/20 hover:text-yellow-400 text-slate-400 transition-all" title="Sửa">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
          </button>
          <button onclick="deleteItem(${item.id})" class="p-1.5 rounded-lg bg-slate-700 hover:bg-red-500/20 hover:text-red-400 text-slate-400 transition-all" title="Xóa">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          </button>
        </div>
      </td>
    </tr>`
  }
  document.getElementById('invoice-rows').innerHTML =
    result.map((item, idx) => rowHTML(item, idx)).join('') ||
    `<tr><td colspan="7" class="py-10 text-center text-slate-500">Không tìm thấy hóa đơn</td></tr>`

  // --- Render danh sách thẻ mobile ---
  const cardEl = document.getElementById('invoice-cards-mobile')
  if (cardEl) {
    cardEl.innerHTML = result.map(item => {
      const lp = Number(item.sell_price) - Number(item.buy_price)
      return `<div class="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div class="flex items-start justify-between mb-3">
          <div class="flex items-center gap-2 flex-1 min-w-0">
            <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:${locColor(item.location)}"></span>
            <span class="text-white font-semibold text-sm truncate">${item.location}</span>
          </div>
          <div class="flex gap-1.5 flex-shrink-0 ml-2">
            <button onclick="openModal(${item.id})" class="p-1.5 rounded-lg bg-slate-700 text-slate-400 active:bg-yellow-500/20 active:text-yellow-400">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
            </button>
            <button onclick="deleteItem(${item.id})" class="p-1.5 rounded-lg bg-slate-700 text-slate-400 active:bg-red-500/20 active:text-red-400">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>
          </div>
        </div>
        <div class="space-y-1.5">
          <div class="flex items-center justify-between bg-slate-800/60 rounded-lg px-3 py-2">
            <div class="text-xs text-slate-500">Số lượng</div>
            <div class="text-white font-semibold text-xs">${item.quantity} ${item.unit || 'chỉ'}</div>
          </div>
          <div class="flex items-center justify-between bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-3 py-2">
            <div class="text-xs text-slate-500">Dự tính bán</div>
            <div class="text-yellow-400 font-bold text-xs">${fmt(item.sell_price)}</div>
          </div>
          <div class="flex items-center justify-between bg-slate-800/60 rounded-lg px-3 py-2">
            <div class="text-xs text-slate-500">Giá mua</div>
            <div class="text-slate-300 font-semibold text-xs">${fmt(item.buy_price)}</div>
          </div>
          <div class="flex items-center justify-between px-1 pt-0.5">
            <span class="text-xs text-slate-500">Lợi nhuận</span>
            <span class="text-sm font-bold ${lp >= 0 ? 'text-emerald-400' : 'text-red-400'}">${lp >= 0 ? '+' : ''}${fmt(lp)}</span>
          </div>
        </div>
      </div>`
    }).join('') || `<div class="py-12 text-center text-slate-500 text-sm">Không tìm thấy hóa đơn</div>`
  }

  // --- Footer tổng cộng ---
  const fqty  = result.reduce((s, i) => s + Number(i.quantity),   0)
  const fsell = result.reduce((s, i) => s + Number(i.sell_price), 0)
  const fbuy  = result.reduce((s, i) => s + Number(i.buy_price),  0)
  const fp    = fsell - fbuy
  const profitClass = fp >= 0 ? 'text-emerald-300' : 'text-red-300'
  const profitBg    = fp >= 0 ? 'bg-emerald-500/10' : 'bg-red-500/10'

  // Footer bảng desktop
  document.getElementById('invoice-foot').setAttribute('class', 'bg-gradient-to-r from-slate-800/80 to-slate-800/40')
  document.getElementById('invoice-foot').innerHTML = `
    <td colspan="2" class="px-4 py-4">
      <span class="inline-flex items-center gap-1.5 text-xs font-bold text-yellow-400 uppercase tracking-wider">
        <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-13a1 1 0 10-2 0v.092a4.535 4.535 0 00-1.676.662C6.602 6.234 6 7.009 6 8c0 .99.602 1.765 1.324 2.246.48.32 1.054.545 1.676.662v1.941c-.391-.127-.68-.317-.843-.504a1 1 0 10-1.51 1.31c.562.649 1.413 1.077 2.353 1.253V15a1 1 0 102 0v-.092a4.535 4.535 0 001.676-.662C13.398 13.766 14 12.991 14 12c0-.99-.602-1.765-1.324-2.246A4.535 4.535 0 0011 9.092V7.151c.391.127.68.317.843.504a1 1 0 101.511-1.31c-.563-.649-1.413-1.077-2.354-1.253V5z" clip-rule="evenodd"/></svg>
        Tổng cộng
      </span>
    </td>
    <td class="px-4 py-4 text-right"><span class="inline-block bg-slate-700/60 text-white font-bold text-sm px-3 py-1 rounded-lg">${fqty}</span></td>
    <td class="px-4 py-4 text-right"><span class="inline-block bg-yellow-500/15 text-yellow-300 font-bold text-sm px-3 py-1 rounded-lg border border-yellow-500/20">${fmt(fsell)}</span></td>
    <td class="px-4 py-4 text-right"><span class="inline-block bg-slate-700/60 text-white font-bold text-sm px-3 py-1 rounded-lg">${fmt(fbuy)}</span></td>
    <td class="px-4 py-4 text-right"><span class="inline-block ${profitBg} ${profitClass} font-bold text-sm px-3 py-1 rounded-lg border ${fp >= 0 ? 'border-emerald-500/20' : 'border-red-500/20'}">${fp >= 0 ? '+' : ''}${fmt(fp)}</span></td>
    <td></td>`

  // Footer mobile
  const mFoot = document.getElementById('invoice-foot-mobile')
  if (mFoot && result.length > 0) {
    mFoot.classList.remove('hidden')
    mFoot.innerHTML = `
      <div class="text-xs font-bold text-yellow-400 uppercase tracking-wide mb-3">Tổng cộng · ${result.length} hóa đơn</div>
      <div class="space-y-1.5">
        <div class="flex items-center justify-between bg-slate-800/60 rounded-lg px-3 py-2"><div class="text-xs text-slate-500">Số lượng</div><div class="text-white font-bold text-sm">${fqty}</div></div>
        <div class="flex items-center justify-between bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-3 py-2"><div class="text-xs text-slate-500">Dự tính bán</div><div class="text-yellow-400 font-bold text-xs">${fmt(fsell)}</div></div>
        <div class="flex items-center justify-between bg-slate-800/60 rounded-lg px-3 py-2"><div class="text-xs text-slate-500">Giá mua</div><div class="text-white font-bold text-xs">${fmt(fbuy)}</div></div>
        <div class="flex items-center justify-between px-1 pt-0.5"><span class="text-xs text-slate-500">Lợi nhuận</span><span class="font-bold ${profitClass}">${fp >= 0 ? '+' : ''}${fmt(fp)}</span></div>
      </div>`
  } else if (mFoot) {
    mFoot.classList.add('hidden')
  }
}

/**
 * Xử lý sắp xếp bảng khi nhấn vào tiêu đề cột.
 * Nếu nhấn cùng cột → đổi chiều; nếu cột khác → sắp xếp tăng dần.
 * @param {string} field - Tên cột cần sắp xếp
 */
function sortBy(field) {
  if (sortField === field) sortDir = sortDir === 'asc' ? 'desc' : 'asc'
  else { sortField = field; sortDir = 'asc' }
  ;['location', 'quantity', 'sell_price', 'buy_price'].forEach(f => {
    const el = document.getElementById(`sort-${f}`)
    if (el) el.textContent = f === sortField ? (sortDir === 'asc' ? '↑' : '↓') : '↕'
  })
  renderTable()
}


/* ============================================================
   GIÁ THƯƠNG HIỆU
============================================================ */

/**
 * Render lưới thẻ chỉnh sửa giá của từng thương hiệu.
 * Mỗi thẻ có form inline cho phép sửa tên, mã và giá rồi lưu ngay.
 */
function renderPricesTab() {
  document.getElementById('brand-edit-cards').innerHTML = brands.map(b => `
    <div class="bg-slate-900 border border-slate-800 rounded-2xl p-6">
      <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-4">
        <div class="min-w-0">
          <div class="text-xl font-black text-white leading-tight break-words">${b.name}</div>
          <span class="inline-block mt-1 px-2 py-0.5 bg-yellow-500/15 text-yellow-400 text-xs font-bold rounded border border-yellow-500/20">${b.code || '—'}</span>
        </div>
        <div class="sm:text-right flex-shrink-0">
          <div class="text-xs text-slate-400 mb-0.5">Giá 1 chỉ</div>
          <div class="text-xl font-bold text-yellow-400">${fmt(b.price)}</div>
        </div>
      </div>
      <div class="space-y-2">
        <div>
          <label class="block text-xs text-slate-500 mb-1">Tên thương hiệu</label>
          <input id="ep-name-${b.id}" type="text" value="${b.name}"
            class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm transition-colors"/>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="block text-xs text-slate-500 mb-1">Mã</label>
            <input id="ep-code-${b.id}" type="text" value="${b.code || ''}"
              class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm transition-colors uppercase"/>
          </div>
          <div>
            <label class="block text-xs text-slate-500 mb-1">Giá / chỉ</label>
            <input id="ep-price-${b.id}" type="number" value="${b.price}"
              class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm transition-colors"/>
          </div>
        </div>
        <button onclick="updateBrand(${b.id})"
          class="w-full py-2 bg-yellow-500 hover:bg-yellow-400 text-slate-900 font-bold text-sm rounded-lg transition-all mt-1">
          Lưu thay đổi
        </button>
      </div>
    </div>`).join('')
}

/**
 * Cập nhật thông tin một thương hiệu (tên, mã, giá) lên Supabase.
 * Sau khi lưu sẽ tải lại danh sách và render lại sidebar + tab giá.
 * @param {number} id - ID của thương hiệu cần cập nhật
 */
async function updateBrand(id) {
  const name  = document.getElementById(`ep-name-${id}`).value.trim()
  const code  = document.getElementById(`ep-code-${id}`).value.trim().toUpperCase()
  const price = parseInt(document.getElementById(`ep-price-${id}`).value)
  if (!name)              { showToast('Tên không được để trống', 'error'); return }
  if (!price || price <= 0) { showToast('Giá không hợp lệ', 'error'); return }
  const { error } = await db.from('brands').update({ name, code, price, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) { showToast('Lỗi cập nhật: ' + error.message, 'error'); return }
  await loadBrands()
  renderPricesTab()
  renderSidebar()
  showToast(`Đã cập nhật thương hiệu ${name}`)
}

/**
 * Thêm một thương hiệu mới vào Supabase.
 * Xóa form sau khi thêm thành công.
 */
async function addBrand() {
  const name  = document.getElementById('new-brand-name').value.trim()
  const code  = document.getElementById('new-brand-code').value.trim().toUpperCase()
  const price = parseInt(document.getElementById('new-brand-price').value)
  if (!name || !code)       { showToast('Nhập đầy đủ tên và mã', 'error'); return }
  if (!price || price <= 0) { showToast('Nhập giá hợp lệ', 'error'); return }
  const { error } = await db.from('brands').insert({ name, code, price })
  if (error) { showToast('Lỗi thêm thương hiệu: ' + error.message, 'error'); return }
  document.getElementById('new-brand-name').value  = ''
  document.getElementById('new-brand-code').value  = ''
  document.getElementById('new-brand-price').value = ''
  await loadBrands()
  renderPricesTab()
  renderSidebar()
  showToast(`Đã thêm thương hiệu ${name}`)
}

/**
 * Render lại danh sách giá thương hiệu nhỏ ở cuối sidebar.
 */
function renderSidebar() {
  document.getElementById('sidebar-prices').innerHTML = brands.map(b => `
    <div class="flex items-center justify-between px-3 py-2 bg-slate-800/60 rounded-lg gap-2">
      <span class="text-xs font-bold text-slate-300">${b.code || b.name}</span>
      <span class="text-xs font-bold text-yellow-400">${fmt(b.price)}</span>
    </div>`).join('')
}


/* ============================================================
   MODAL THÊM / SỬA HÓA ĐƠN
============================================================ */

/**
 * Mở modal thêm hóa đơn mới hoặc sửa hóa đơn đã có.
 * Nếu truyền id → điền sẵn thông tin vào form để sửa.
 * @param {number|null} id - ID hóa đơn cần sửa (null = thêm mới)
 */
function openModal(id = null) {
  editingId = id
  document.getElementById('modal-title').textContent = id ? 'Sửa hóa đơn' : 'Thêm hóa đơn mới'
  document.getElementById('save-btn').textContent    = id ? 'Cập nhật' : 'Lưu'

  const item = id ? items.find(i => i.id === id) : null
  document.getElementById('form-id').value       = id || ''
  document.getElementById('form-cat').value      = item ? (item.danh_muc || 'Vàng') : 'Vàng'
  document.getElementById('form-location').value = item ? item.location   : ''
  document.getElementById('form-qty').value      = item ? item.quantity   : 1
  document.getElementById('form-unit').value     = item ? item.unit       : 'Chỉ'
  document.getElementById('form-sell').value     = item ? item.sell_price : ''
  document.getElementById('form-buy').value      = item ? item.buy_price  : ''

  // Cập nhật danh sách gợi ý nơi mua
  document.getElementById('loc-list').innerHTML = locations().map(l => `<option value="${l}"/>`).join('')
  updatePriceHints()
  updateProfit()

  const modal = document.getElementById('modal')
  modal.classList.remove('hidden')
  modal.classList.add('flex')
}

/**
 * Đóng modal và xóa trạng thái đang chỉnh sửa.
 */
function closeModal() {
  document.getElementById('modal').classList.add('hidden')
  document.getElementById('modal').classList.remove('flex')
  editingId = null
}

/**
 * Cập nhật các nút gợi ý giá bán nhanh dựa trên số lượng và giá thương hiệu.
 * Ví dụ: nhập 2 chỉ → hiện nút "LT: 33.94M", "MT: 34.00M", ...
 */
function updatePriceHints() {
  const qty = parseFloat(document.getElementById('form-qty').value) || 1
  document.getElementById('price-hints').innerHTML = brands.map(b => {
    const total = b.price * qty
    return `<button type="button" onclick="document.getElementById('form-sell').value=${total};updateProfit()"
      class="text-xs px-2 py-1 bg-slate-700 hover:bg-yellow-500/20 hover:text-yellow-400 text-slate-400 rounded-lg transition-all">
      ${b.code || b.name}: ${fmtM(total)}
    </button>`
  }).join('')
}

/**
 * Tính và hiển thị lợi nhuận dự kiến trong modal theo thời gian thực.
 * Cập nhật mỗi khi người dùng thay đổi giá bán hoặc giá mua.
 */
function updateProfit() {
  const sell = parseFloat(document.getElementById('form-sell').value) || 0
  const buy  = parseFloat(document.getElementById('form-buy').value)  || 0
  const prev = document.getElementById('profit-preview')
  if (!sell && !buy) { prev.classList.add('hidden'); return }
  const p = sell - buy
  prev.classList.remove('hidden')
  prev.className = `p-3 rounded-xl border ${p >= 0 ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-red-500/5 border-red-500/20'}`
  prev.innerHTML = `<div class="flex items-center justify-between text-sm">
    <span class="text-slate-400">Lợi nhuận dự kiến</span>
    <span class="font-bold ${p >= 0 ? 'text-emerald-400' : 'text-red-400'}">${p >= 0 ? '+' : ''}${fmt(p)}</span>
  </div>`
}

/**
 * Lưu hóa đơn (thêm mới hoặc cập nhật) lên Supabase.
 * Hiển thị spinner trong khi chờ, sau đó đóng modal và tải lại dữ liệu.
 */
async function saveItem() {
  const danh_muc   = document.getElementById('form-cat').value.trim()      || 'Vàng'
  const location   = document.getElementById('form-location').value.trim()
  const quantity   = parseFloat(document.getElementById('form-qty').value)
  const unit       = document.getElementById('form-unit').value.trim()      || 'Chỉ'
  const sell_price = parseFloat(document.getElementById('form-sell').value) || 0
  const buy_price  = parseFloat(document.getElementById('form-buy').value)  || 0

  if (!location || !quantity) { showToast('Vui lòng nhập nơi mua và số lượng', 'error'); return }

  // Hiển thị trạng thái đang lưu
  const btn = document.getElementById('save-btn')
  btn.disabled = true
  btn.innerHTML = `<svg class="w-4 h-4 spin" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Đang lưu...`

  let error
  if (editingId) {
    // Cập nhật hóa đơn hiện có
    ;({ error } = await db.from('items').update({ danh_muc, location, quantity, unit, sell_price, buy_price }).eq('id', editingId))
  } else {
    // Thêm hóa đơn mới
    ;({ error } = await db.from('items').insert({ danh_muc, location, quantity, unit, sell_price, buy_price }))
  }

  btn.disabled = false
  btn.textContent = editingId ? 'Cập nhật' : 'Lưu'

  if (error) { showToast('Lỗi lưu dữ liệu: ' + error.message, 'error'); return }

  showToast(editingId ? 'Đã cập nhật hóa đơn' : 'Đã thêm hóa đơn mới')
  closeModal()
  await loadItems()
  if (activeTab === 'dashboard') renderDashboard()
  if (activeTab === 'invoices')  { activeCat ? renderTable() : renderCategories() }
}

/**
 * Xóa một hóa đơn khỏi Supabase sau khi người dùng xác nhận.
 * @param {number} id - ID hóa đơn cần xóa
 */
async function deleteItem(id) {
  if (!confirm('Xóa hóa đơn này?')) return
  const { error } = await db.from('items').delete().eq('id', id)
  if (error) { showToast('Lỗi xóa: ' + error.message, 'error'); return }
  showToast('Đã xóa hóa đơn')
  await loadItems()
  if (activeTab === 'dashboard') renderDashboard()
  if (activeTab === 'invoices')  { activeCat ? renderTable() : renderCategories() }
}


/* ============================================================
   XÁC THỰC (Authentication)
============================================================ */

/**
 * Hiển thị màn hình đăng nhập toàn trang.
 * Tự động focus vào ô email để người dùng nhập ngay.
 */
function showLoginScreen() {
  document.getElementById('login-screen').classList.remove('hidden')
  setTimeout(() => document.getElementById('login-email')?.focus(), 100)
}

/**
 * Ẩn màn hình đăng nhập, hiện nội dung chính của ứng dụng.
 */
function hideLoginScreen() {
  document.getElementById('login-screen').classList.add('hidden')
}

/**
 * Bật / tắt hiển thị mật khẩu trong ô input đăng nhập.
 * Đổi icon mắt theo trạng thái hiện tại.
 */
function toggleLoginPwd() {
  const inp    = document.getElementById('login-password')
  const eyeOff = document.getElementById('pwd-eye-off')
  const eyeOn  = document.getElementById('pwd-eye-on')
  const isHidden = inp.type === 'password'
  inp.type = isHidden ? 'text' : 'password'
  eyeOff.classList.toggle('hidden', isHidden)
  eyeOn.classList.toggle('hidden', !isHidden)
}

/**
 * Hiển thị hoặc ẩn thông báo lỗi đăng nhập.
 * @param {string} msg - Nội dung lỗi (truyền chuỗi rỗng để ẩn)
 */
function setLoginError(msg) {
  const el = document.getElementById('login-error')
  if (msg) { el.textContent = msg; el.classList.remove('hidden') }
  else      { el.classList.add('hidden') }
}

/**
 * Thực hiện đăng nhập bằng email và mật khẩu qua Supabase Auth.
 * Nếu thành công, onAuthStateChange sẽ tự động gọi onUserLoggedIn.
 */
async function signIn() {
  const email    = document.getElementById('login-email').value.trim()
  const password = document.getElementById('login-password').value
  if (!email || !password) { setLoginError('Vui lòng nhập email và mật khẩu'); return }

  // Hiển thị trạng thái đang đăng nhập
  const btn = document.getElementById('login-btn')
  btn.disabled = true
  btn.innerHTML = `<svg class="w-4 h-4 spin" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Đang đăng nhập...`
  setLoginError('')

  const { error } = await db.auth.signInWithPassword({ email, password })

  btn.disabled = false
  btn.textContent = 'Đăng nhập'

  if (error) {
    // Dịch thông báo lỗi sang tiếng Việt
    const msg = error.message.includes('Invalid login')       ? 'Email hoặc mật khẩu không đúng'
              : error.message.includes('Email not confirmed') ? 'Tài khoản chưa xác nhận email'
              : error.message
    setLoginError(msg)
  }
  // Nếu đăng nhập thành công → onAuthStateChange tự xử lý tiếp
}

/**
 * Đăng xuất khỏi ứng dụng.
 * onAuthStateChange sẽ tự gọi onUserLoggedOut để dọn dẹp.
 */
async function signOut() {
  await db.auth.signOut()
}

/**
 * Xử lý khi người dùng đăng nhập thành công.
 * Ẩn login screen, hiển thị email, tải dữ liệu và bắt đầu realtime.
 * @param {object} user - Đối tượng user từ Supabase session
 */
function onUserLoggedIn(user) {
  currentUser = user
  hideLoginScreen()
  document.getElementById('sidebar-user-email').textContent = user?.email || ''
  // Xin quyền notification ngay sau đăng nhập
  requestNotificationPermission()
  loadAll().then(() => subscribeRealtime())
}

/**
 * Xử lý khi người dùng đăng xuất.
 * Hủy kết nối realtime, xóa dữ liệu local và hiển thị lại login screen.
 */
function onUserLoggedOut() {
  if (db) db.removeAllChannels()
  items       = []
  brands      = []
  messages    = []
  currentUser = null
  showLoginScreen()
}


/* ============================================================
   SUPABASE — withAuth (Tự động làm mới token hết hạn)
============================================================ */

/**
 * Wrapper bọc quanh các lời gọi Supabase để xử lý lỗi JWT hết hạn.
 * Nếu gặp lỗi 401 / JWT expired → tự động gọi refreshSession() và thử lại.
 * Nếu refresh thất bại → báo lỗi và tự đăng xuất sau 1.5 giây.
 * @param {Function} fn - Hàm async trả về kết quả Supabase ({data, error})
 */
async function withAuth(fn) {
  const result = await fn()
  if (result?.error) {
    const msg        = result.error.message || ''
    const isJwtError = msg.includes('JWT') || msg.includes('token') || result.error.status === 401
    if (isJwtError) {
      // Thử làm mới token
      const { error: refreshErr } = await db.auth.refreshSession()
      if (refreshErr) {
        showToast('Phiên đăng nhập hết hạn, vui lòng đăng nhập lại', 'error')
        setTimeout(() => db.auth.signOut(), 1500)
        return result
      }
      // Thử lại lời gọi gốc sau khi refresh thành công
      return await fn()
    }
  }
  return result
}

/**
 * Tải danh sách hóa đơn từ Supabase, tự refresh token nếu cần.
 * Cập nhật biến toàn cục `items` và badge đếm trên sidebar nav.
 */
async function loadItems() {
  if (!db) return
  const { data, error } = await withAuth(() =>
    db.from('items').select('*').order('created_at', { ascending: false })
  )
  if (error) { showToast('Lỗi tải hóa đơn: ' + error.message, 'error'); return }
  items = data || []
  document.getElementById('nav-count').textContent = items.length
}

/**
 * Tải danh sách thương hiệu từ Supabase, tự refresh token nếu cần.
 * Cập nhật biến toàn cục `brands`.
 */
async function loadBrands() {
  if (!db) return
  const { data, error } = await withAuth(() =>
    db.from('brands').select('*').order('name')
  )
  if (error) { showToast('Lỗi tải thương hiệu: ' + error.message, 'error'); return }
  brands = data || []
}


/* ============================================================
   TIN NHẮN (Messages)
============================================================ */

// Số tin nhắn chưa đọc — lưu theo timestamp tin nhắn cuối đã đọc
let lastReadAt = localStorage.getItem('lastReadAt') || '1970-01-01'

/**
 * Tải danh sách tin nhắn từ Supabase (100 tin mới nhất).
 * Cập nhật biến toàn cục `messages` và badge thông báo.
 */
async function loadMessages() {
  if (!db) return
  const { data, error } = await withAuth(() =>
    db.from('messages').select('*').order('created_at', { ascending: true }).limit(100)
  )
  if (error) { showToast('Lỗi tải tin nhắn: ' + error.message, 'error'); return }
  messages = data || []
  updateMsgBadge()
  if (activeTab === 'messages') renderMessagesTab()
}

/**
 * Render toàn bộ danh sách tin nhắn vào khung chat.
 * Tin nhắn của mình nằm bên phải (màu vàng), tin người khác bên trái.
 * Nhóm liên tiếp của cùng người gửi lại với nhau cho gọn.
 */
function renderMessagesTab() {
  const list = document.getElementById('messages-list')
  if (!list) return

  document.getElementById('msg-count').textContent = `${messages.length} tin nhắn`

  if (!messages.length) {
    list.innerHTML = `<div class="text-center text-slate-500 text-sm py-12">Chưa có tin nhắn nào.<br>Hãy bắt đầu cuộc trò chuyện!</div>`
    return
  }

  const myEmail = currentUser?.email || ''

  list.innerHTML = messages.map((msg, idx) => {
    const isMe   = msg.user_email === myEmail
    const prev   = messages[idx - 1]
    // Nhóm: nếu người gửi trước giống người gửi hiện tại → ẩn tên
    const showHeader = !prev || prev.user_email !== msg.user_email

    const time = new Date(msg.created_at).toLocaleString('vi-VN', {
      hour: '2-digit', minute: '2-digit',
      day: '2-digit',  month: '2-digit'
    })

    // Lấy chữ cái đầu của email làm avatar
    const avatar  = msg.user_email.charAt(0).toUpperCase()
    const content = escapeHtml(msg.content).replace(/\n/g, '<br>')

    if (isMe) {
      // Tin nhắn của mình — căn phải, màu vàng
      return `<div class="flex flex-col items-end ${showHeader ? 'mt-3' : 'mt-0.5'}">
        ${showHeader ? `<span class="text-[10px] text-slate-500 mb-1 mr-1">${time}</span>` : ''}
        <div class="max-w-[80%] bg-yellow-500 text-slate-900 rounded-2xl rounded-br-sm px-4 py-2.5 text-sm font-medium leading-relaxed break-words">
          ${content}
        </div>
      </div>`
    } else {
      // Tin nhắn của người khác — căn trái, màu slate
      return `<div class="flex items-end gap-2 ${showHeader ? 'mt-3' : 'mt-0.5'}">
        ${showHeader
          ? `<div class="w-7 h-7 rounded-full bg-slate-700 border border-slate-600 flex items-center justify-center text-xs font-bold text-slate-300 flex-shrink-0">${avatar}</div>`
          : `<div class="w-7 flex-shrink-0"></div>`
        }
        <div class="max-w-[80%]">
          ${showHeader ? `<div class="text-[10px] text-slate-500 mb-1 ml-1">${msg.user_email} · ${time}</div>` : ''}
          <div class="bg-slate-800 border border-slate-700 text-white rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm leading-relaxed break-words">
            ${content}
          </div>
        </div>
      </div>`
    }
  }).join('')

  // Cuộn xuống tin nhắn mới nhất
  list.scrollTop = list.scrollHeight
}

/**
 * Gửi tin nhắn mới lên Supabase.
 * Xóa ô input sau khi gửi thành công, reset chiều cao textarea.
 */
async function sendMessage() {
  const input   = document.getElementById('msg-input')
  const content = input.value.trim()
  if (!content) return
  if (!currentUser) { showToast('Chưa đăng nhập', 'error'); return }

  input.disabled = true

  const { data, error } = await db.from('messages').insert({
    user_id:    currentUser.id,
    user_email: currentUser.email,
    content
  }).select().single()

  input.disabled = false

  if (error) { showToast('Gửi thất bại: ' + error.message, 'error'); return }

  // Optimistic UI — thêm tin nhắn vào mảng ngay lập tức, không chờ Realtime
  // Tránh thêm trùng nếu Realtime cũng push về
  if (data && !messages.find(m => m.id === data.id)) {
    messages.push(data)
    renderMessagesTab()
    markMessagesRead()
  }

  input.value = ''
  input.style.height = 'auto'
  input.focus()
}

/**
 * Xử lý phím trong ô nhập tin nhắn.
 * Enter → gửi tin nhắn. Shift+Enter → xuống dòng bình thường.
 */
function handleMsgKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
}

/**
 * Tự động tăng chiều cao textarea theo nội dung người dùng nhập.
 * Giới hạn tối đa 5 dòng (~120px).
 */
function autoResizeInput(el) {
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 120) + 'px'
}

/**
 * Cập nhật badge số tin nhắn chưa đọc trên sidebar nav và bottom nav.
 * So sánh timestamp tin nhắn với lần cuối người dùng mở tab messages.
 */
function updateMsgBadge() {
  if (activeTab === 'messages') return
  const unread = messages.filter(m =>
    m.user_email !== currentUser?.email &&
    new Date(m.created_at) > new Date(lastReadAt)
  ).length

  const sidebarBadge = document.getElementById('nav-msg-badge')
  const bnavBadge    = document.getElementById('bnav-msg-badge')

  if (unread > 0) {
    const label = unread > 99 ? '99+' : String(unread)
    ;[sidebarBadge, bnavBadge].forEach(el => {
      if (!el) return
      el.textContent = label
      el.classList.remove('hidden')
    })
  } else {
    ;[sidebarBadge, bnavBadge].forEach(el => el?.classList.add('hidden'))
  }
}

/**
 * Đánh dấu đã đọc tất cả tin nhắn khi mở tab messages.
 * Lưu timestamp vào localStorage để nhớ qua các lần reload.
 */
function markMessagesRead() {
  lastReadAt = new Date().toISOString()
  localStorage.setItem('lastReadAt', lastReadAt)
  const sidebarBadge = document.getElementById('nav-msg-badge')
  const bnavBadge    = document.getElementById('bnav-msg-badge')
  ;[sidebarBadge, bnavBadge].forEach(el => el?.classList.add('hidden'))
}

/* ============================================================
   BROWSER NOTIFICATION — Thông báo tin nhắn mới
============================================================ */

/**
 * Xin quyền gửi browser notification.
 * Được gọi khi user đăng nhập thành công.
 * Nếu user từ chối → im lặng, không hỏi lại.
 */
async function requestNotificationPermission() {
  if (!('Notification' in window)) return
  if (Notification.permission === 'default') {
    await Notification.requestPermission()
  }
}

/**
 * Gửi browser notification khi có tin nhắn mới từ người khác.
 * Chỉ gửi nếu:
 * - Trình duyệt hỗ trợ Notification API
 * - Người dùng đã cấp quyền
 * - Tin nhắn không phải của mình
 * - Tab hiện tại không phải tab messages
 * @param {object} msg - Đối tượng tin nhắn từ Supabase
 */
function pushNotification(msg) {
  if (!('Notification' in window)) return
  if (Notification.permission !== 'granted') return
  if (msg.user_email === currentUser?.email) return

  // Rút ngắn tên người gửi (lấy phần trước @)
  const sender  = msg.user_email.split('@')[0]
  const preview = msg.content.length > 60
    ? msg.content.slice(0, 60) + '...'
    : msg.content

  const notif = new Notification(`💬 ${sender}`, {
    body: preview,
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    tag: 'qlhd-message',   // Cùng tag → tin mới ghi đè tin cũ, không bị spam
    renotify: true,
  })

  // Nhấn vào notification → focus tab và mở tab messages
  notif.onclick = () => {
    window.focus()
    switchTab('messages')
    notif.close()
  }

  // Tự đóng sau 5 giây
  setTimeout(() => notif.close(), 5000)
}

/**
 * Escape ký tự HTML đặc biệt trong nội dung tin nhắn để tránh XSS.
 * Quan trọng vì content được render bằng innerHTML.
 * @param {string} str - Chuỗi cần escape
 */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/* ============================================================
   ĐỒNG HỒ & REALTIME
============================================================ */

/**
 * Cập nhật dòng thời gian "Cập nhật lúc ..." ở header.
 * Được gọi mỗi 60 giây.
 */
function updateClock() {
  document.getElementById('page-time').textContent =
    'Cập nhật lúc ' + new Date().toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })
}

let realtimeChannel = null

/**
 * Đăng ký kênh Supabase Realtime để nhận cập nhật tức thì.
 * Lắng nghe cả bảng `items` (hóa đơn) và `messages` (tin nhắn).
 * Hủy kênh cũ trước khi đăng ký kênh mới để tránh nghe trùng.
 */
function subscribeRealtime() {
  if (!db) return
  if (realtimeChannel) db.removeChannel(realtimeChannel)

  realtimeChannel = db.channel('app-realtime')
    // Lắng nghe thay đổi bảng items
    .on('postgres_changes', { event: '*', schema: 'public', table: 'items' }, async () => {
      await loadItems()
      if (activeTab === 'dashboard') renderDashboard()
      if (activeTab === 'invoices')  { activeCat ? renderTable() : renderCategories() }
    })
    // Lắng nghe tin nhắn mới từ người khác qua Realtime
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async (payload) => {
      const msg = payload.new

      // Bỏ qua nếu tin đã có trong mảng (do optimistic UI đã thêm rồi)
      if (messages.find(m => m.id === msg.id)) return

      messages.push(msg)
      document.getElementById('msg-count').textContent = `${messages.length} tin nhắn`

      if (activeTab === 'messages') {
        renderMessagesTab()
        markMessagesRead()
      } else {
        // Đang ở tab khác → badge + browser notification
        updateMsgBadge()
        const b = document.getElementById('nav-msg-badge')
        if (b) { b.classList.add('scale-125'); setTimeout(() => b.classList.remove('scale-125'), 200) }
        pushNotification(msg)
      }
    })
    .subscribe()
}


/* ============================================================
   KHỞI ĐỘNG ỨNG DỤNG
============================================================ */

// Bắt đầu đồng hồ, cập nhật mỗi 1 phút
updateClock()
setInterval(updateClock, 60000)

// Hiển thị tab mặc định (Tổng quan)
switchTab('dashboard')

// Khởi động listener xác thực — đây là điểm vào chính của ứng dụng
// Supabase sẽ phát sự kiện INITIAL_SESSION ngay khi tải trang
// nếu người dùng đã đăng nhập trước đó (session còn trong localStorage)
if (db) {
  db.auth.onAuthStateChange((event, session) => {
    if (
      event === 'SIGNED_IN'       ||  // Vừa đăng nhập
      event === 'TOKEN_REFRESHED' ||  // Token vừa được làm mới tự động
      event === 'INITIAL_SESSION'     // Khôi phục session cũ khi reload trang
    ) {
      if (session?.user) {
        onUserLoggedIn(session.user)
      } else {
        onUserLoggedOut()
      }
    } else if (event === 'SIGNED_OUT') {
      onUserLoggedOut()
    }
  })
} else {
  // Supabase chưa được cấu hình → hiện login screen để thông báo
  showLoginScreen()
}
