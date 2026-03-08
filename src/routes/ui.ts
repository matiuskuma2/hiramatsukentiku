// ==============================================
// Frontend UI Routes (Step 6 — AI Production Hardening + Full UI)
// SPA-style pages rendered from Hono with Alpine.js
//
// Pages:
//   /ui/projects — Project list with filters, create modal
//   /ui/projects/:id — Project detail with 7 tabs:
//     - Risk Centre (operational)
//     - Cost Items (with edit modal)
//     - Diff Resolution (adopt/keep/dismiss/manual)
//     - Cost Summary (category breakdown)
//     - Sales Estimate (CRUD + gap viz + severity explanation)
//     - AI & Warnings (hardened: confidence/severity display,
//       AI status, condition check, parse-document, warning management)
//     - PDF読取確認 (document parse verification screen)
// ==============================================
import { Hono } from 'hono';
import type { AppEnv } from '../types/bindings';

const uiRoutes = new Hono<AppEnv>();

// ── Shared Layout ──
function layout(title: string, bodyContent: string, activeTab: string = '') {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - 平松建築 原価管理</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <style>
    [x-cloak] { display: none !important; }
    .fade-in { animation: fadeIn 0.25s ease-out; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
    .risk-critical { border-left: 4px solid #ef4444; }
    .risk-high { border-left: 4px solid #f97316; }
    .risk-medium { border-left: 4px solid #eab308; }
    .risk-low { border-left: 4px solid #22c55e; }
    .slide-in { animation: slideIn 0.3s ease-out; }
    @keyframes slideIn { from { opacity:0; transform:translateX(20px); } to { opacity:1; transform:translateX(0); } }
    .pulse-dot { animation: pulseDot 2s infinite; }
    @keyframes pulseDot { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
    .bar-animate { animation: barGrow 0.6s ease-out; }
    @keyframes barGrow { from { width: 0%; } }
    .toast-enter { animation: toastIn 0.3s ease-out; }
    @keyframes toastIn { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
    .skeleton { background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite; }
    @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
  </style>
  <script>
    tailwind.config = {
      theme: { extend: { colors: {
        hm: { 50:'#f0fdf4', 100:'#dcfce7', 200:'#bbf7d0', 300:'#86efac', 400:'#4ade80', 500:'#22c55e', 600:'#16a34a', 700:'#15803d', 800:'#166534', 900:'#14532d' }
      }}}
    }
  </script>
</head>
<body class="bg-gray-50 min-h-screen">
  <nav class="bg-white shadow-sm border-b sticky top-0 z-50">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="flex justify-between h-14">
        <div class="flex items-center space-x-8">
          <a href="/ui/projects" class="flex items-center space-x-2">
            <i class="fas fa-building text-hm-600 text-lg"></i>
            <span class="font-bold text-gray-800 text-sm">平松建築 原価管理</span>
          </a>
          <div class="hidden md:flex space-x-1" x-data="navLinks()" x-init="loadNav()">
            <a href="/ui/projects" class="px-3 py-2 rounded-md text-sm font-medium \${activeTab === 'projects' ? 'bg-hm-50 text-hm-700' : 'text-gray-600 hover:bg-gray-100'}">
              <i class="fas fa-folder-open mr-1"></i>案件一覧
            </a>
            <a href="/ui/manual" class="px-3 py-2 rounded-md text-sm font-medium \${activeTab === 'manual' ? 'bg-hm-50 text-hm-700' : 'text-gray-600 hover:bg-gray-100'}">
              <i class="fas fa-book mr-1"></i>使い方ガイド
            </a>
            <a x-show="navUser && (navUser.role==='admin' || navUser.role==='manager')" x-cloak href="/ui/admin" class="px-3 py-2 rounded-md text-sm font-medium \${activeTab === 'admin' ? 'bg-hm-50 text-hm-700' : 'text-gray-600 hover:bg-gray-100'}">
              <i class="fas fa-cog mr-1"></i>管理
            </a>
          </div>
        </div>
        <div class="flex items-center space-x-3">
          <a href="/ui/manual" class="text-hm-600 hover:text-hm-800 text-sm font-medium px-2 py-1 rounded hover:bg-hm-50 transition md:hidden"><i class="fas fa-question-circle mr-1"></i>ヘルプ</a>
          <div x-data="userMenu()" x-init="loadUser()" class="flex items-center gap-2">
            <span x-show="user" class="text-xs text-gray-500 hidden sm:inline" x-text="user?.name"></span>
            <span x-show="user" class="text-xs px-1.5 py-0.5 rounded-full font-medium" :class="{'bg-red-100 text-red-700':user?.role==='admin','bg-blue-100 text-blue-700':user?.role==='manager','bg-green-100 text-green-700':user?.role==='estimator','bg-gray-100 text-gray-600':user?.role==='viewer'}" x-text="user?.role"></span>
            <button x-show="user" @click="logout()" class="text-xs text-gray-400 hover:text-red-500 transition" title="ログアウト"><i class="fas fa-sign-out-alt"></i></button>
            <a x-show="!user" href="/ui/login" class="text-xs text-hm-600 hover:text-hm-800 font-medium"><i class="fas fa-sign-in-alt mr-1"></i>ログイン</a>
          </div>
          <span class="text-xs text-gray-400">v0.9.0</span>
        </div>
      </div>
    </div>
  </nav>
  <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
    ${bodyContent}
  </main>
  <script>
    const api = {
      async get(path) { try { const r = await fetch('/api' + path); return r.json(); } catch(e) { return { success:false, error: e.message }; } },
      async post(path, body) { try { const r = await fetch('/api' + path, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) }); return r.json(); } catch(e) { return { success:false, error: e.message }; } },
      async patch(path, body) { try { const r = await fetch('/api' + path, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) }); return r.json(); } catch(e) { return { success:false, error: e.message }; } },
      async del(path) { try { const r = await fetch('/api' + path, { method:'DELETE' }); return r.json(); } catch(e) { return { success:false, error: e.message }; } },
    };
    function userMenu() {
      return {
        user: null,
        async loadUser() {
          try { const r = await fetch('/api/auth/me'); const d = await r.json(); if (d.success) this.user = d.data; } catch {}
        },
        async logout() {
          await fetch('/api/auth/logout', { method: 'POST' });
          location.href = '/ui/login';
        }
      };
    }
    function navLinks() {
      return { navUser: null, async loadNav() { try { const r = await fetch('/api/auth/me'); const d = await r.json(); if(d.success) this.navUser = d.data; } catch{} } };
    }
    const fmt = {
      yen(n) { return n != null ? '¥' + Math.round(n).toLocaleString('ja-JP') : '-'; },
      pct(n) { return n != null ? (Math.round(n*10)/10) + '%' : '-'; },
      date(s) { if(!s) return '-'; const d=new Date(s); return d.getFullYear()+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+String(d.getDate()).padStart(2,'0'); },
      datetime(s) { if(!s) return '-'; const d=new Date(s); return d.toLocaleString('ja-JP'); },
      num(n) { return n != null ? Math.round(n).toLocaleString('ja-JP') : '-'; },
      diffType(t) { return {amount_changed:'金額変動', quantity_changed:'数量変動', unit_price_changed:'単価変動', fixed_amount_changed:'固定額変動', selection_changed:'選択変更', item_added:'項目追加', item_removed:'項目削除'}[t]||t; },
      status(s) { return {draft:'下書き', calculating:'計算中', in_progress:'進行中', needs_review:'要レビュー', reviewed:'レビュー済', archived:'アーカイブ'}[s]||s; },
      reviewStatus(s) { return {pending:'未確認', confirmed:'確認済', needs_review:'要確認', flagged:'フラグ'}[s]||s; },
      estimateType(t) { return {rough:'概算', internal:'社内', contract:'契約', execution:'実行'}[t]||t; },
      reasonCat(c) { return {site_condition:'現場条件', customer_request:'顧客要望', regulatory:'法規制', spec_change:'仕様変更', price_update:'価格改定', correction:'訂正', vendor_quote:'業者見積', other:'その他'}[c]||c||'未分類'; },
      confidenceLabel(l) { return {high:'高', medium:'中', low:'低'}[l]||l; },
      confidenceColor(l) { return {high:'text-green-600', medium:'text-yellow-600', low:'text-red-600'}[l]||'text-gray-500'; },
      confidenceBg(l) { return {high:'bg-green-100 text-green-700', medium:'bg-yellow-100 text-yellow-700', low:'bg-red-100 text-red-700'}[l]||'bg-gray-100'; },
      severityIcon(s) { return {error:'fas fa-times-circle text-red-500', warning:'fas fa-exclamation-triangle text-yellow-500', info:'fas fa-info-circle text-blue-400'}[s]||'fas fa-circle text-gray-400'; },
    };
  </script>
</body>
</html>`;
}

// ── Status Badge Colors ──
const STATUS_CLASSES: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600', calculating: 'bg-indigo-100 text-indigo-700',
  in_progress: 'bg-blue-100 text-blue-700', needs_review: 'bg-yellow-100 text-yellow-700',
  reviewed: 'bg-green-100 text-green-700', archived: 'bg-purple-100 text-purple-600',
};

// ==========================================================
// / → Redirect to projects
// ==========================================================
uiRoutes.get('/', (c) => c.redirect('/ui/projects'));

// ==========================================================
// /ui/projects — Project List
// ==========================================================
uiRoutes.get('/ui/projects', (c) => {
  return c.html(layout('案件一覧', `
    <div x-data="projectList()" x-init="load()">
      <div class="flex justify-between items-center mb-6">
        <div>
          <h1 class="text-2xl font-bold text-gray-800"><i class="fas fa-folder-open mr-2 text-hm-600"></i>案件一覧</h1>
          <p class="text-sm text-gray-500 mt-1">見積案件の管理・作成</p>
        </div>
        <button @click="showCreate = true" class="bg-hm-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-hm-700 transition shadow-sm">
          <i class="fas fa-plus mr-1.5"></i>新規案件
        </button>
      </div>
      <div class="flex gap-2 mb-5 flex-wrap">
        <template x-for="s in statusFilters" :key="s.value">
          <button @click="filter = s.value; load()"
            :class="filter === s.value ? 'bg-hm-600 text-white shadow-sm' : 'bg-white text-gray-600 hover:bg-gray-50 border'"
            class="px-3.5 py-1.5 rounded-full text-xs font-medium transition">
            <i :class="s.icon" class="mr-1"></i><span x-text="s.label"></span>
          </button>
        </template>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <template x-for="p in projects" :key="p.id">
          <a :href="'/ui/projects/' + p.id" class="bg-white rounded-xl border hover:shadow-md transition-shadow p-5 block group">
            <div class="flex justify-between items-start mb-3">
              <div><span class="font-mono text-xs text-hm-600" x-text="p.project_code"></span>
                <h3 class="font-semibold text-gray-900 mt-0.5 group-hover:text-hm-700 transition" x-text="p.project_name"></h3></div>
              <span class="px-2 py-0.5 text-xs rounded-full font-medium" :class="statusClass(p.status)" x-text="fmt.status(p.status)"></span>
            </div>
            <div class="flex items-center gap-3 text-xs text-gray-500">
              <span x-show="p.lineup"><i class="fas fa-home mr-0.5"></i><span x-text="p.lineup"></span></span>
              <span x-show="p.tsubo"><i class="fas fa-ruler-combined mr-0.5"></i><span x-text="p.tsubo + '坪'"></span></span>
              <span x-show="p.customer_name"><i class="fas fa-user mr-0.5"></i><span x-text="p.customer_name"></span></span>
            </div>
            <div class="flex justify-between items-center mt-3 pt-3 border-t text-xs text-gray-400">
              <div class="flex items-center gap-3">
                <span>Rev <span x-text="p.revision_no || 0"></span></span>
                <span class="text-hm-600 font-medium"><i class="fas fa-user-pen mr-0.5"></i>担当: <span x-text="p.assigned_to_name || '未設定'"></span></span>
              </div>
              <span x-text="fmt.date(p.updated_at)"></span>
            </div>
          </a>
        </template>
      </div>
      <div x-show="!loading && projects.length === 0" class="bg-white rounded-xl border p-12 text-center">
        <i class="fas fa-inbox text-4xl text-gray-300 mb-3"></i><p class="text-gray-500">案件がありません</p>
      </div>
      <div x-show="loading" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <template x-for="i in 6"><div class="bg-white rounded-xl border p-5"><div class="skeleton h-4 w-20 rounded mb-2"></div><div class="skeleton h-5 w-40 rounded mb-3"></div><div class="skeleton h-3 w-32 rounded"></div></div></template>
      </div>
      <div class="mt-4 text-sm text-gray-500" x-show="meta.total > 0" x-text="meta.total + ' 件'"></div>
      <!-- Create Modal -->
      <div x-show="showCreate" x-cloak class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" @click.self="showCreate=false">
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 slide-in" @click.stop>
          <h2 class="text-lg font-bold mb-5"><i class="fas fa-plus-circle mr-2 text-hm-600"></i>新規案件作成</h2>
          <div class="space-y-4">
            <div class="grid grid-cols-2 gap-3">
              <div><label class="block text-xs font-medium text-gray-500 mb-1">案件コード <span class="text-red-400">*</span></label><input x-model="form.project_code" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500 focus:border-transparent" placeholder="2026-001"></div>
              <div><label class="block text-xs font-medium text-gray-500 mb-1">ラインナップ <span class="text-red-400">*</span></label><select x-model="form.lineup" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500"><option value="SHIN">SHIN</option><option value="RIN">RIN</option><option value="MOKU_OOYANE">MOKU 大屋根</option><option value="MOKU_HIRAYA">MOKU 平屋</option><option value="MOKU_ROKU">MOKU ROKU</option></select></div>
            </div>
            <div><label class="block text-xs font-medium text-gray-500 mb-1">案件名 <span class="text-red-400">*</span></label><input x-model="form.project_name" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500" placeholder="山田邸新築工事"></div>
            <div><label class="block text-xs font-medium text-gray-500 mb-1">顧客名</label><input x-model="form.customer_name" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500"></div>
            <div class="grid grid-cols-3 gap-3">
              <div><label class="block text-xs font-medium text-gray-500 mb-1">坪数</label><input x-model.number="form.tsubo" type="number" step="0.1" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500"></div>
              <div><label class="block text-xs font-medium text-gray-500 mb-1">建築面積(m²)</label><input x-model.number="form.building_area_m2" type="number" step="0.01" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500"></div>
              <div><label class="block text-xs font-medium text-gray-500 mb-1">延床面積(m²)</label><input x-model.number="form.total_floor_area_m2" type="number" step="0.01" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500"></div>
            </div>
            <div class="grid grid-cols-3 gap-3">
              <div><label class="block text-xs font-medium text-gray-500 mb-1">断熱等級</label><select x-model="form.insulation_grade" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500"><option value="">-</option><option value="5">5</option><option value="6">6</option></select></div>
              <div><label class="block text-xs font-medium text-gray-500 mb-1">屋根形状</label><select x-model="form.roof_shape" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500"><option value="">-</option><option value="kirizuma">切妻</option><option value="yosemune">寄棟</option><option value="katanagare">片流れ</option><option value="flat">フラット</option></select></div>
              <div><label class="block text-xs font-medium text-gray-500 mb-1">防火区分</label><select x-model="form.fire_zone_type" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500"><option value="standard">一般</option><option value="semi_fire">準防火</option><option value="fire">防火</option></select></div>
            </div>
          </div>
          <div class="flex justify-end gap-2 mt-6">
            <button @click="showCreate=false" class="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition">キャンセル</button>
            <button @click="create()" class="px-5 py-2 text-sm bg-hm-600 text-white rounded-lg hover:bg-hm-700 transition font-medium" :disabled="creating">
              <span x-show="!creating"><i class="fas fa-check mr-1"></i>作成</span>
              <span x-show="creating"><i class="fas fa-spinner fa-spin mr-1"></i>作成中...</span>
            </button>
          </div>
          <div x-show="createError" class="mt-3 p-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600" x-text="createError"></div>
        </div>
      </div>
    </div>
    <script>
    function projectList() {
      return {
        projects: [], meta: { total: 0 }, filter: '', showCreate: false, creating: false, createError: '', loading: true,
        statusFilters: [
          {value:'', label:'全件', icon:'fas fa-th'},{value:'draft', label:'下書き', icon:'fas fa-pencil-alt'},
          {value:'in_progress', label:'進行中', icon:'fas fa-play-circle'},{value:'needs_review', label:'要レビュー', icon:'fas fa-exclamation-circle'},
          {value:'reviewed', label:'レビュー済', icon:'fas fa-check-circle'},
        ],
        form: { project_code:'', project_name:'', lineup:'SHIN', customer_name:'', tsubo:null, building_area_m2:null, total_floor_area_m2:null, insulation_grade:'', roof_shape:'', fire_zone_type:'standard' },
        statusClass(s) { return {'draft':'bg-gray-100 text-gray-600','calculating':'bg-indigo-100 text-indigo-700','in_progress':'bg-blue-100 text-blue-700','needs_review':'bg-yellow-100 text-yellow-700','reviewed':'bg-green-100 text-green-700','archived':'bg-purple-100 text-purple-600'}[s] || 'bg-gray-100 text-gray-600'; },
        async load() { this.loading = true; const q = this.filter ? '?status=' + this.filter : ''; const res = await api.get('/projects' + q); if (res.success) { this.projects = res.data; this.meta = res.meta || { total: res.data?.length || 0 }; } this.loading = false; },
        async create() {
          this.creating = true; this.createError = '';
          const body = { ...this.form };
          if (!body.tsubo) delete body.tsubo; if (!body.building_area_m2) delete body.building_area_m2; if (!body.total_floor_area_m2) delete body.total_floor_area_m2;
          if (!body.insulation_grade) delete body.insulation_grade; if (!body.roof_shape) delete body.roof_shape; if (!body.customer_name) delete body.customer_name;
          const res = await api.post('/projects', body); this.creating = false;
          if (res.success) { this.showCreate = false; location.href = '/ui/projects/' + res.data.id; } else { this.createError = res.error || '作成に失敗しました'; }
        }
      };
    }
    </script>
  `, 'projects'));
});

// ==========================================================
// /ui/projects/:id — Full Project Detail with All Tabs
// ==========================================================
uiRoutes.get('/ui/projects/:id', (c) => {
  const id = c.req.param('id');
  return c.html(layout('案件詳細', `
    <div x-data="projectDetail(${id})" x-init="init()">
      <!-- Breadcrumb -->
      <div class="flex items-center text-sm text-gray-500 mb-4">
        <a href="/ui/projects" class="hover:text-hm-600 transition"><i class="fas fa-folder-open mr-1"></i>案件一覧</a>
        <i class="fas fa-chevron-right mx-2 text-xs text-gray-300"></i>
        <span class="text-gray-800 font-medium" x-text="project?.project_name || '読み込み中...'"></span>
      </div>
      <!-- Loading -->
      <div x-show="loading" class="space-y-4"><div class="bg-white rounded-xl border p-5"><div class="skeleton h-6 w-48 rounded mb-2"></div><div class="skeleton h-4 w-32 rounded"></div></div></div>
      <!-- Project Header -->
      <div x-show="!loading && project" class="bg-white rounded-xl shadow-sm border p-5 mb-5">
        <div class="flex justify-between items-start">
          <div>
            <div class="flex items-center gap-3 mb-1.5">
              <span class="font-mono text-sm text-hm-600 bg-hm-50 px-2 py-0.5 rounded" x-text="project?.project_code"></span>
              <span class="px-2.5 py-0.5 text-xs rounded-full font-semibold" :class="statusClass(project?.status)" x-text="fmt.status(project?.status)"></span>
              <span class="text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded">Rev <span x-text="project?.revision_no || 0"></span></span>
            </div>
            <h1 class="text-xl font-bold text-gray-900" x-text="project?.project_name"></h1>
            <div class="flex items-center gap-3 text-sm text-gray-500 mt-1.5">
              <span x-show="project?.lineup"><i class="fas fa-home mr-1 text-gray-400"></i><span x-text="project?.lineup"></span></span>
              <span x-show="project?.tsubo"><i class="fas fa-ruler-combined mr-1 text-gray-400"></i><span x-text="project?.tsubo + '坪'"></span></span>
              <span x-show="project?.customer_name"><i class="fas fa-user mr-1 text-gray-400"></i><span x-text="project?.customer_name"></span></span>
              <span x-show="project?.assigned_to_name" class="text-hm-600"><i class="fas fa-user-pen mr-1"></i>担当: <span x-text="project?.assigned_to_name"></span></span>
            </div>
          </div>
          <div class="flex gap-2 flex-shrink-0">
            <button @click="enqueue('initial')" x-show="!project?.current_snapshot_id" class="bg-hm-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-hm-700 transition shadow-sm" :disabled="enqueueing">
              <span x-show="!enqueueing"><i class="fas fa-calculator mr-1"></i>初期計算</span><span x-show="enqueueing"><i class="fas fa-spinner fa-spin mr-1"></i>計算中...</span>
            </button>
            <div x-show="project?.current_snapshot_id" class="flex gap-2">
              <button @click="showRegenModal=true" class="bg-blue-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition shadow-sm"><i class="fas fa-sync-alt mr-1"></i>再計算</button>
            </div>
          </div>
        </div>
      </div>
      <!-- Tab Navigation -->
      <div x-show="!loading" class="flex border-b mb-5 bg-white rounded-t-xl overflow-x-auto">
        <template x-for="t in tabs"><button @click="activeTab = t.id; onTabChange(t.id)"
          class="px-4 py-3 text-sm font-medium border-b-2 transition whitespace-nowrap flex items-center gap-1.5"
          :class="activeTab === t.id ? 'border-hm-600 text-hm-700 bg-hm-50/50' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'">
          <i :class="t.icon"></i><span x-text="t.label"></span>
          <span x-show="t.badge > 0" class="ml-1 px-1.5 py-0.5 text-xs rounded-full font-bold" :class="t.badgeColor || 'bg-gray-200 text-gray-600'" x-text="t.badge"></span>
        </button></template>
      </div>

      <!-- TAB 1: Risk Centre -->
      <div x-show="activeTab === 'risk'" class="fade-in space-y-5">
        <div x-show="!risk" class="text-center py-12 text-gray-400"><i class="fas fa-spinner fa-spin text-2xl mb-2"></i><p>リスク情報を読み込み中...</p></div>
        <div x-show="risk">
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
            <div class="bg-white rounded-xl border p-4" :class="'risk-' + (risk?.summary?.risk_level || 'low')">
              <div class="text-xs text-gray-500 mb-1"><i class="fas fa-shield-alt mr-1"></i>リスクレベル</div>
              <div class="text-2xl font-bold" :class="{'text-red-600':risk?.summary?.risk_level==='critical','text-orange-500':risk?.summary?.risk_level==='high','text-yellow-500':risk?.summary?.risk_level==='medium','text-green-500':risk?.summary?.risk_level==='low'}" x-text="(risk?.summary?.risk_level||'').toUpperCase()"></div>
              <div class="flex items-center gap-2 mt-1 text-xs"><span class="text-gray-400">Score <span x-text="risk?.summary?.risk_score"></span></span>
                <span x-show="risk?.summary?.error_count" class="text-red-500 font-medium"><span x-text="risk?.summary?.error_count"></span> エラー</span>
                <span x-show="risk?.summary?.warning_count" class="text-yellow-600 font-medium"><span x-text="risk?.summary?.warning_count"></span> 警告</span></div>
            </div>
            <div class="bg-white rounded-xl border p-4"><div class="text-xs text-gray-500 mb-1"><i class="fas fa-clipboard-check mr-1"></i>入力完了率</div>
              <div class="text-2xl font-bold text-gray-800"><span x-text="risk?.input_completion?.overall_rate || 0"></span>%</div>
              <div class="w-full bg-gray-200 rounded-full h-2 mt-2"><div class="bg-hm-500 h-2 rounded-full bar-animate" :style="'width:' + (risk?.input_completion?.overall_rate||0) + '%'"></div></div>
            </div>
            <div class="bg-white rounded-xl border p-4"><div class="text-xs text-gray-500 mb-1"><i class="fas fa-check-double mr-1"></i>レビュー進捗</div>
              <div class="text-2xl font-bold text-gray-800"><span x-text="risk?.review_progress?.confirmed || 0"></span><span class="text-sm text-gray-400 font-normal"> / <span x-text="risk?.review_progress?.total_items || 0"></span></span></div>
              <div class="w-full bg-gray-200 rounded-full h-2 mt-2"><div class="bg-blue-500 h-2 rounded-full bar-animate" :style="'width:' + (risk?.review_progress?.rate||0) + '%'"></div></div>
            </div>
            <div class="bg-white rounded-xl border p-4"><div class="text-xs text-gray-500 mb-1"><i class="fas fa-yen-sign mr-1"></i>粗利率</div>
              <div class="text-2xl font-bold" :class="risk?.sales_gap ? (risk.sales_gap.overall_margin_rate >= 25 ? 'text-green-600' : risk.sales_gap.overall_margin_rate >= 15 ? 'text-yellow-600' : 'text-red-600') : 'text-gray-300'">
                <span x-text="risk?.sales_gap ? risk.sales_gap.overall_margin_rate + '%' : '未設定'"></span></div>
              <div class="text-xs text-gray-400 mt-1" x-text="risk?.sales_gap ? '期待 ' + risk.sales_gap.expected_margin_rate + '%' : '売価未登録'"></div>
            </div>
          </div>
          <div class="space-y-2"><h3 class="text-sm font-semibold text-gray-700 mb-2"><i class="fas fa-list-ul mr-1"></i>リスク項目 (<span x-text="risk?.risks?.length || 0"></span>)</h3>
            <template x-for="r in risk?.risks || []" :key="r.id">
              <div class="bg-white rounded-lg border p-4 flex items-start gap-3 transition hover:shadow-sm"
                :class="{'border-red-200 bg-red-50/30': r.severity==='error', 'border-yellow-200 bg-yellow-50/30': r.severity==='warning', 'border-blue-200 bg-blue-50/30': r.severity==='info'}">
                <div class="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
                  :class="{'bg-red-100': r.severity==='error', 'bg-yellow-100': r.severity==='warning', 'bg-blue-100': r.severity==='info'}">
                  <i :class="fmt.severityIcon(r.severity)"></i></div>
                <div class="flex-1 min-w-0"><div class="flex items-center gap-2">
                  <span class="font-medium text-sm text-gray-800" x-text="r.title"></span>
                  <span class="px-1.5 py-0.5 text-xs rounded font-medium"
                    :class="{'bg-red-100 text-red-700': r.category==='sales', 'bg-purple-100 text-purple-700': r.category==='ai', 'bg-blue-100 text-blue-700': r.category==='regeneration', 'bg-gray-100 text-gray-600': r.category==='input' || r.category==='system', 'bg-orange-100 text-orange-700': r.category==='review'}" x-text="r.category"></span></div>
                  <p class="text-xs text-gray-500 mt-0.5 truncate" x-text="r.description"></p></div>
                <span x-show="r.action_required" class="flex-shrink-0 px-2 py-1 bg-red-100 text-red-700 text-xs rounded-full font-medium"><i class="fas fa-bolt mr-0.5"></i>要対応</span>
              </div>
            </template>
          </div>
        </div>
      </div>

      <!-- TAB 2: Cost Items -->
      <div x-show="activeTab === 'items'" class="fade-in">

      <!-- TAB: Project Edit (CR-05) -->
      <div x-show="activeTab === 'edit'" class="fade-in space-y-5">
        <div x-show="editError" class="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600"><i class="fas fa-exclamation-circle mr-1"></i><span x-text="editError"></span></div>

        <!-- Basic Info -->
        <div class="bg-white rounded-xl border p-5">
          <h3 class="font-semibold mb-4 text-gray-800"><i class="fas fa-home mr-2 text-hm-600"></i>基本情報</h3>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div><label class="block text-xs font-medium text-gray-500 mb-1">案件コード</label>
              <div class="w-full bg-gray-100 rounded-lg px-3 py-2 text-sm text-gray-600 font-mono" x-text="project?.project_code"></div></div>
            <div><label class="block text-xs font-medium text-gray-500 mb-1">案件名</label>
              <input :value="project?.project_name" @change="saveProjectEdit('project_name', $event.target.value)" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500 focus:border-transparent"></div>
            <div><label class="block text-xs font-medium text-gray-500 mb-1">顧客名</label>
              <input :value="project?.customer_name || ''" @change="saveProjectEdit('customer_name', $event.target.value || null)" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500 focus:border-transparent" placeholder="山田太郎"></div>
          </div>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
            <div><label class="block text-xs font-medium text-gray-500 mb-1">ラインナップ <span class="text-red-400">*</span></label>
              <select :value="project?.lineup" @change="saveProjectEdit('lineup', $event.target.value)" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500">
                <option value="SHIN">SHIN</option><option value="RIN">RIN</option><option value="MOKU_OOYANE">MOKU 大屋根</option><option value="MOKU_HIRAYA">MOKU 平屋</option><option value="MOKU_ROKU">MOKU ROKU</option></select></div>
            <div><label class="block text-xs font-medium text-gray-500 mb-1">ステータス</label>
              <select :value="project?.status" @change="saveProjectEdit('status', $event.target.value)" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500">
                <option value="draft">下書き</option><option value="in_progress">進行中</option><option value="needs_review">要レビュー</option><option value="reviewed">レビュー済</option><option value="archived">アーカイブ</option></select></div>
            <div><label class="block text-xs font-medium text-gray-500 mb-1">断熱等級</label>
              <select :value="project?.insulation_grade || ''" @change="saveProjectEdit('insulation_grade', $event.target.value || null)" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500">
                <option value="">-</option><option value="5">5</option><option value="6">6</option></select></div>
            <div><label class="block text-xs font-medium text-gray-500 mb-1">防火区分</label>
              <select :value="project?.fire_zone_type || ''" @change="saveProjectEdit('fire_zone_type', $event.target.value || null)" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500">
                <option value="">-</option><option value="standard">一般</option><option value="semi_fire">準防火</option><option value="fire">防火</option></select></div>
          </div>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
            <div><label class="block text-xs font-medium text-gray-500 mb-1">屋根形状</label>
              <select :value="project?.roof_shape || ''" @change="saveProjectEdit('roof_shape', $event.target.value || null)" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500">
                <option value="">-</option><option value="kirizuma">切妻</option><option value="yosemune">寄棟</option><option value="katanagare">片流れ</option><option value="flat">フラット</option><option value="other">その他</option></select></div>
            <div><label class="block text-xs font-medium text-gray-500 mb-1">WB工法</label>
              <select :value="String(project?.has_wb ?? '')" @change="saveProjectEdit('has_wb', parseInt($event.target.value))" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500">
                <option value="1">あり</option><option value="0">なし</option></select></div>
            <div><label class="block text-xs font-medium text-gray-500 mb-1">平屋</label>
              <select :value="String(project?.is_one_story ?? '')" @change="saveProjectEdit('is_one_story', parseInt($event.target.value))" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500">
                <option value="">-</option><option value="1">はい</option><option value="0">いいえ</option></select></div>
            <div><label class="block text-xs font-medium text-gray-500 mb-1">二世帯</label>
              <select :value="String(project?.is_two_family ?? '')" @change="saveProjectEdit('is_two_family', parseInt($event.target.value))" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500">
                <option value="">-</option><option value="1">はい</option><option value="0">いいえ</option></select></div>
          </div>
        </div>

        <!-- Area / Size -->
        <div class="bg-white rounded-xl border p-5">
          <h3 class="font-semibold mb-4 text-gray-800"><i class="fas fa-ruler-combined mr-2 text-blue-600"></i>面積・寸法</h3>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div><label class="block text-xs font-medium text-gray-500 mb-1">坪数</label>
              <input type="number" step="0.1" :value="project?.tsubo || ''" @change="saveProjectEdit('tsubo', parseFloat($event.target.value) || null)" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500" placeholder="35.5"></div>
            <div><label class="block text-xs font-medium text-gray-500 mb-1">建築面積 (m2)</label>
              <input type="number" step="0.01" :value="project?.building_area_m2 || ''" @change="saveProjectEdit('building_area_m2', parseFloat($event.target.value) || null)" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500"></div>
            <div><label class="block text-xs font-medium text-gray-500 mb-1">延床面積 (m2)</label>
              <input type="number" step="0.01" :value="project?.total_floor_area_m2 || ''" @change="saveProjectEdit('total_floor_area_m2', parseFloat($event.target.value) || null)" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500"></div>
            <div><label class="block text-xs font-medium text-gray-500 mb-1">1F面積 (m2)</label>
              <input type="number" step="0.01" :value="project?.floor1_area_m2 || ''" @change="saveProjectEdit('floor1_area_m2', parseFloat($event.target.value) || null)" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500"></div>
          </div>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
            <div><label class="block text-xs font-medium text-gray-500 mb-1">2F面積 (m2)</label>
              <input type="number" step="0.01" :value="project?.floor2_area_m2 || ''" @change="saveProjectEdit('floor2_area_m2', parseFloat($event.target.value) || null)" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500"></div>
            <div><label class="block text-xs font-medium text-gray-500 mb-1">屋根面積 (m2)</label>
              <input type="number" step="0.01" :value="project?.roof_area_m2 || ''" @change="saveProjectEdit('roof_area_m2', parseFloat($event.target.value) || null)" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500"></div>
            <div><label class="block text-xs font-medium text-gray-500 mb-1">外壁面積 (m2)</label>
              <input type="number" step="0.01" :value="project?.exterior_wall_area_m2 || ''" @change="saveProjectEdit('exterior_wall_area_m2', parseFloat($event.target.value) || null)" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500"></div>
            <div><label class="block text-xs font-medium text-gray-500 mb-1">内壁面積 (m2)</label>
              <input type="number" step="0.01" :value="project?.interior_wall_area_m2 || ''" @change="saveProjectEdit('interior_wall_area_m2', parseFloat($event.target.value) || null)" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500"></div>
          </div>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
            <div><label class="block text-xs font-medium text-gray-500 mb-1">天井面積 (m2)</label>
              <input type="number" step="0.01" :value="project?.ceiling_area_m2 || ''" @change="saveProjectEdit('ceiling_area_m2', parseFloat($event.target.value) || null)" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500"></div>
            <div><label class="block text-xs font-medium text-gray-500 mb-1">基礎周長 (m)</label>
              <input type="number" step="0.01" :value="project?.foundation_perimeter_m || ''" @change="saveProjectEdit('foundation_perimeter_m', parseFloat($event.target.value) || null)" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500"></div>
            <div><label class="block text-xs font-medium text-gray-500 mb-1">屋根周長 (m)</label>
              <input type="number" step="0.01" :value="project?.roof_perimeter_m || ''" @change="saveProjectEdit('roof_perimeter_m', parseFloat($event.target.value) || null)" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500"></div>
            <div><label class="block text-xs font-medium text-gray-500 mb-1">ポーチ面積 (m2)</label>
              <input type="number" step="0.01" :value="project?.porch_area_m2 || ''" @change="saveProjectEdit('porch_area_m2', parseFloat($event.target.value) || null)" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500"></div>
          </div>
        </div>

        <!-- Location -->
        <div class="bg-white rounded-xl border p-5">
          <h3 class="font-semibold mb-4 text-gray-800"><i class="fas fa-map-marker-alt mr-2 text-red-500"></i>所在地</h3>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div><label class="block text-xs font-medium text-gray-500 mb-1">都道府県</label>
              <input :value="project?.prefecture || ''" @change="saveProjectEdit('prefecture', $event.target.value || null)" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500" placeholder="静岡県"></div>
            <div><label class="block text-xs font-medium text-gray-500 mb-1">市区町村</label>
              <input :value="project?.city || ''" @change="saveProjectEdit('city', $event.target.value || null)" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500" placeholder="浜松市"></div>
            <div><label class="block text-xs font-medium text-gray-500 mb-1">自治体コード</label>
              <input :value="project?.municipality_code || ''" @change="saveProjectEdit('municipality_code', $event.target.value || null)" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500" placeholder="221309"></div>
            <div><label class="block text-xs font-medium text-gray-500 mb-1">静岡県内</label>
              <select :value="String(project?.is_shizuoka_prefecture ?? '')" @change="saveProjectEdit('is_shizuoka_prefecture', parseInt($event.target.value))" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500">
                <option value="">-</option><option value="1">はい</option><option value="0">いいえ</option></select></div>
          </div>
          <div class="mt-4"><label class="block text-xs font-medium text-gray-500 mb-1">住所テキスト</label>
            <input :value="project?.address_text || ''" @change="saveProjectEdit('address_text', $event.target.value || null)" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500" placeholder="静岡県浜松市中央区..."></div>
        </div>

        <!-- Solar / Options -->
        <div class="bg-white rounded-xl border p-5">
          <h3 class="font-semibold mb-4 text-gray-800"><i class="fas fa-solar-panel mr-2 text-yellow-500"></i>太陽光・オプション</h3>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div><label class="block text-xs font-medium text-gray-500 mb-1">太陽光パネル</label>
              <select :value="String(project?.has_pv ?? '')" @change="saveProjectEdit('has_pv', parseInt($event.target.value))" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500">
                <option value="">-</option><option value="1">あり</option><option value="0">なし</option></select></div>
            <div><label class="block text-xs font-medium text-gray-500 mb-1">PV容量 (kW)</label>
              <input type="number" step="0.1" :value="project?.pv_capacity_kw || ''" @change="saveProjectEdit('pv_capacity_kw', parseFloat($event.target.value) || null)" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500"></div>
            <div><label class="block text-xs font-medium text-gray-500 mb-1">PVパネル数</label>
              <input type="number" :value="project?.pv_panels || ''" @change="saveProjectEdit('pv_panels', parseInt($event.target.value) || null)" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500"></div>
            <div><label class="block text-xs font-medium text-gray-500 mb-1">蓄電池</label>
              <select :value="String(project?.has_battery ?? '')" @change="saveProjectEdit('has_battery', parseInt($event.target.value))" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500">
                <option value="">-</option><option value="1">あり</option><option value="0">なし</option></select></div>
          </div>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
            <div><label class="block text-xs font-medium text-gray-500 mb-1">蓄電池容量 (kWh)</label>
              <input type="number" step="0.1" :value="project?.battery_capacity_kwh || ''" @change="saveProjectEdit('battery_capacity_kwh', parseFloat($event.target.value) || null)" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500"></div>
            <div><label class="block text-xs font-medium text-gray-500 mb-1">ドーマー</label>
              <select :value="String(project?.has_dormer ?? '')" @change="saveProjectEdit('has_dormer', parseInt($event.target.value))" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500">
                <option value="">-</option><option value="1">あり</option><option value="0">なし</option></select></div>
            <div><label class="block text-xs font-medium text-gray-500 mb-1">ロフト</label>
              <select :value="String(project?.has_loft ?? '')" @change="saveProjectEdit('has_loft', parseInt($event.target.value))" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500">
                <option value="">-</option><option value="1">あり</option><option value="0">なし</option></select></div>
            <div><label class="block text-xs font-medium text-gray-500 mb-1">焼杉</label>
              <select :value="String(project?.has_yakisugi ?? '')" @change="saveProjectEdit('has_yakisugi', parseInt($event.target.value))" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500">
                <option value="">-</option><option value="1">あり</option><option value="0">なし</option></select></div>
          </div>
        </div>

        <!-- Plumbing / Infrastructure -->
        <div class="bg-white rounded-xl border p-5">
          <h3 class="font-semibold mb-4 text-gray-800"><i class="fas fa-wrench mr-2 text-gray-500"></i>設備・インフラ</h3>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div><label class="block text-xs font-medium text-gray-500 mb-1">上水道引込</label>
              <select :value="String(project?.has_water_intake ?? '')" @change="saveProjectEdit('has_water_intake', parseInt($event.target.value))" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500">
                <option value="">-</option><option value="1">あり</option><option value="0">なし</option></select></div>
            <div><label class="block text-xs font-medium text-gray-500 mb-1">下水道引込</label>
              <select :value="String(project?.has_sewer_intake ?? '')" @change="saveProjectEdit('has_sewer_intake', parseInt($event.target.value))" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500">
                <option value="">-</option><option value="1">あり</option><option value="0">なし</option></select></div>
            <div><label class="block text-xs font-medium text-gray-500 mb-1">メーター</label>
              <select :value="String(project?.has_water_meter ?? '')" @change="saveProjectEdit('has_water_meter', parseInt($event.target.value))" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500">
                <option value="">-</option><option value="1">あり</option><option value="0">なし</option></select></div>
            <div><label class="block text-xs font-medium text-gray-500 mb-1">配管距離 (m)</label>
              <input type="number" step="0.1" :value="project?.plumbing_distance_m || ''" @change="saveProjectEdit('plumbing_distance_m', parseFloat($event.target.value) || null)" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500"></div>
          </div>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
            <div><label class="block text-xs font-medium text-gray-500 mb-1">雨樋延長 (m)</label>
              <input type="number" step="0.1" :value="project?.gutter_length_m || ''" @change="saveProjectEdit('gutter_length_m', parseFloat($event.target.value) || null)" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500"></div>
            <div><label class="block text-xs font-medium text-gray-500 mb-1">竪樋延長 (m)</label>
              <input type="number" step="0.1" :value="project?.downspout_length_m || ''" @change="saveProjectEdit('downspout_length_m', parseFloat($event.target.value) || null)" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500"></div>
          </div>
        </div>

        <!-- Margin Rates -->
        <div class="bg-white rounded-xl border p-5">
          <h3 class="font-semibold mb-4 text-gray-800"><i class="fas fa-percentage mr-2 text-green-600"></i>粗利率設定</h3>
          <div class="grid grid-cols-3 gap-4">
            <div><label class="block text-xs font-medium text-gray-500 mb-1">標準粗利率 (%)</label>
              <input type="number" step="0.1" :value="project?.standard_gross_margin_rate || ''" @change="saveProjectEdit('standard_gross_margin_rate', parseFloat($event.target.value) || null)" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500" placeholder="30"></div>
            <div><label class="block text-xs font-medium text-gray-500 mb-1">太陽光粗利率 (%)</label>
              <input type="number" step="0.1" :value="project?.solar_gross_margin_rate || ''" @change="saveProjectEdit('solar_gross_margin_rate', parseFloat($event.target.value) || null)" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500" placeholder="25"></div>
            <div><label class="block text-xs font-medium text-gray-500 mb-1">オプション粗利率 (%)</label>
              <input type="number" step="0.1" :value="project?.option_gross_margin_rate || ''" @change="saveProjectEdit('option_gross_margin_rate', parseFloat($event.target.value) || null)" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500" placeholder="30"></div>
          </div>
          <div class="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800">
            <i class="fas fa-info-circle mr-1"></i>案件個別の粗利率を設定すると、売価ギャップ判定にこの値が使われます。未設定の場合はシステムデフォルト値（標準30%、太陽光25%、オプション30%）が使用されます。</div>
        </div>

        <!-- Saving indicator -->
        <div x-show="editSaving" class="fixed top-16 right-4 z-50 bg-hm-600 text-white px-4 py-2 rounded-lg shadow-lg text-sm toast-enter">
          <i class="fas fa-spinner fa-spin mr-1"></i>保存中...</div>
      </div>


        <div class="flex items-center justify-between mb-4">
          <div class="flex gap-2"><input x-model="itemSearch" class="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-64 focus:ring-2 focus:ring-hm-500" placeholder="工種名で検索...">
            <select x-model="itemReviewFilter" class="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"><option value="">全ステータス</option><option value="pending">未確認</option><option value="confirmed">確認済</option><option value="needs_review">要確認</option><option value="flagged">フラグ</option></select></div>
          <div class="text-sm text-gray-500"><span x-text="filteredItems().length"></span> / <span x-text="items.length"></span> 件</div>
        </div>
        <div class="bg-white rounded-xl shadow-sm border overflow-hidden"><div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-200"><thead class="bg-gray-50"><tr>
            <th class="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 w-24">カテゴリ</th>
            <th class="px-3 py-2.5 text-left text-xs font-semibold text-gray-500">明細名</th>
            <th class="px-3 py-2.5 text-right text-xs font-semibold text-gray-500 w-28">数量</th>
            <th class="px-3 py-2.5 text-right text-xs font-semibold text-gray-500 w-28">自動金額</th>
            <th class="px-3 py-2.5 text-right text-xs font-semibold text-gray-500 w-28">最終金額</th>
            <th class="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 w-20">状態</th>
            <th class="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 w-16">操作</th>
          </tr></thead><tbody class="divide-y divide-gray-100">
            <template x-for="item in filteredItems()" :key="item.id">
              <tr class="hover:bg-gray-50 text-sm cursor-pointer transition" @click="openEditModal(item)">
                <td class="px-3 py-2.5 text-xs text-gray-500 font-mono" x-text="item.category_code"></td>
                <td class="px-3 py-2.5"><div class="text-gray-800 font-medium" x-text="item.item_name"></div>
                  <div x-show="item.override_reason" class="text-xs text-orange-500 mt-0.5 truncate max-w-xs" x-text="item.override_reason"></div></td>
                <td class="px-3 py-2.5 text-right font-mono text-xs"><span x-text="item.final_quantity || '-'"></span><span class="text-gray-400 ml-0.5" x-text="item.unit || ''"></span></td>
                <td class="px-3 py-2.5 text-right text-gray-500" x-text="fmt.yen(item.auto_amount)"></td>
                <td class="px-3 py-2.5 text-right font-semibold" :class="item.manual_amount != null ? 'text-orange-600' : 'text-gray-800'" x-text="fmt.yen(item.final_amount)"></td>
                <td class="px-3 py-2.5 text-center"><span class="px-2 py-0.5 text-xs rounded-full font-medium"
                  :class="{'bg-green-100 text-green-700':item.review_status==='confirmed','bg-gray-100 text-gray-600':item.review_status==='pending','bg-yellow-100 text-yellow-700':item.review_status==='needs_review','bg-red-100 text-red-700':item.review_status==='flagged'}" x-text="fmt.reviewStatus(item.review_status)"></span></td>
                <td class="px-3 py-2.5 text-center" @click.stop><button @click="openEditModal(item)" class="text-hm-600 hover:text-hm-800 transition"><i class="fas fa-pen-to-square"></i></button></td>
              </tr>
            </template>
          </tbody></table></div>
          <div x-show="items.length === 0" class="py-12 text-center text-gray-400"><i class="fas fa-calculator text-3xl mb-2"></i><p>スナップショットを作成してください</p></div>
        </div>
        <!-- Edit Modal -->
        <div x-show="editModal.show" x-cloak class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" @click.self="editModal.show=false">
          <div class="bg-white rounded-2xl shadow-2xl w-full max-w-xl p-6 slide-in max-h-[90vh] overflow-y-auto" @click.stop>
            <div class="flex justify-between items-center mb-4"><h2 class="text-lg font-bold"><i class="fas fa-pen-to-square mr-2 text-hm-600"></i>工種明細 編集</h2><button @click="editModal.show=false" class="text-gray-400 hover:text-gray-600"><i class="fas fa-times"></i></button></div>
            <div class="bg-gray-50 rounded-lg p-3 mb-4"><div class="font-medium text-gray-800" x-text="editModal.item?.item_name"></div>
              <div class="flex gap-3 text-xs text-gray-500 mt-1"><span x-text="editModal.item?.category_code"></span><span>自動: <span class="font-mono" x-text="fmt.yen(editModal.item?.auto_amount)"></span></span><span>現在: <span class="font-mono font-semibold" x-text="fmt.yen(editModal.item?.final_amount)"></span></span></div></div>
            <div class="space-y-4">
              <div class="grid grid-cols-3 gap-3"><div><label class="block text-xs font-medium text-gray-500 mb-1">手修正 数量</label><input x-model.number="editModal.form.manual_quantity" type="number" step="0.01" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500" :placeholder="editModal.item?.auto_quantity || ''"></div>
                <div><label class="block text-xs font-medium text-gray-500 mb-1">手修正 単価</label><input x-model.number="editModal.form.manual_unit_price" type="number" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500"></div>
                <div><label class="block text-xs font-medium text-gray-500 mb-1">手修正 金額</label><input x-model.number="editModal.form.manual_amount" type="number" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500"></div></div>
              <div><label class="block text-xs font-medium text-gray-500 mb-1">変更理由カテゴリ</label><select x-model="editModal.form.override_reason_category" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"><option value="">未選択</option><option value="site_condition">現場条件</option><option value="customer_request">顧客要望</option><option value="regulatory">法規制</option><option value="spec_change">仕様変更</option><option value="price_update">価格改定</option><option value="correction">訂正</option><option value="vendor_quote">業者見積</option><option value="other">その他</option></select></div>
              <div><label class="block text-xs font-medium text-gray-500 mb-1">変更理由</label><textarea x-model="editModal.form.override_reason" rows="2" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500" placeholder="変更理由を記入..."></textarea></div>
              <div><label class="block text-xs font-medium text-gray-500 mb-1">メモ</label><textarea x-model="editModal.form.note" rows="2" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500"></textarea></div>
              <div class="grid grid-cols-2 gap-3"><div><label class="block text-xs font-medium text-gray-500 mb-1">レビューステータス</label><select x-model="editModal.form.review_status" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"><option value="">変更なし</option><option value="pending">未確認</option><option value="confirmed">確認済</option><option value="needs_review">要確認</option><option value="flagged">フラグ</option></select></div>
                <div><label class="block text-xs font-medium text-gray-500 mb-1">業者名</label><input x-model="editModal.form.vendor_name" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"></div></div>
            </div>
            <div x-show="editModal.form.manual_amount || editModal.form.manual_quantity || editModal.form.manual_unit_price" class="bg-orange-50 border border-orange-200 rounded-lg p-3 mt-4 text-sm">
              <div class="font-medium text-orange-800 mb-1"><i class="fas fa-info-circle mr-1"></i>変更プレビュー</div>
              <div class="flex gap-4 text-xs"><span>現在: <span class="font-mono" x-text="fmt.yen(editModal.item?.final_amount)"></span></span><span x-show="editModal.form.manual_amount">→ 手修正額: <span class="font-mono font-bold text-orange-700" x-text="fmt.yen(editModal.form.manual_amount)"></span></span></div></div>
            <div class="flex justify-end gap-2 mt-5"><button @click="editModal.show=false" class="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">キャンセル</button>
              <button @click="saveItemEdit()" class="px-5 py-2 text-sm bg-hm-600 text-white rounded-lg hover:bg-hm-700 font-medium" :disabled="editModal.saving"><span x-show="!editModal.saving"><i class="fas fa-save mr-1"></i>保存</span><span x-show="editModal.saving"><i class="fas fa-spinner fa-spin mr-1"></i>保存中...</span></button></div>
            <div x-show="editModal.error" class="mt-3 p-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600" x-text="editModal.error"></div>
          </div>
        </div>
      </div>

      <!-- TAB 3: Diff Resolution -->
      <div x-show="activeTab === 'diffs'" class="fade-in">
        <div x-show="diffMeta" class="flex items-center gap-4 mb-4 bg-white rounded-lg border p-3">
          <div class="text-sm"><span class="font-semibold" x-text="diffMeta?.total || 0"></span> 件の差分</div>
          <div class="flex gap-2 text-xs"><span class="px-2 py-0.5 bg-red-100 text-red-700 rounded-full">重要 <span x-text="diffMeta?.significant || 0"></span></span>
            <span class="px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded-full">pending <span x-text="diffMeta?.pending || 0"></span></span>
            <span class="px-2 py-0.5 bg-green-100 text-green-700 rounded-full">解決済 <span x-text="diffMeta?.resolved || 0"></span></span></div>
          <div class="flex-1"></div>
          <select x-model="diffFilter" @change="loadDiffs()" class="border border-gray-300 rounded-lg px-2 py-1 text-xs"><option value="">全件</option><option value="pending">未解決のみ</option><option value="significant">重要のみ</option></select>
        </div>
        <div x-show="diffs.length === 0 && !diffsLoading" class="bg-white rounded-xl border p-12 text-center text-gray-400"><i class="fas fa-check-circle text-4xl text-green-400 mb-3"></i><p class="text-lg font-medium text-gray-600">未解決の差分はありません</p></div>
        <div class="space-y-3">
          <template x-for="d in diffs" :key="d.id">
            <div class="bg-white rounded-lg border p-4 transition hover:shadow-sm" :class="{'border-red-300':d.is_significant&&d.resolution_status==='pending','opacity-60':d.resolution_status!=='pending'}">
              <div class="flex justify-between items-start"><div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1"><span class="font-semibold text-sm text-gray-800" x-text="d.item_name"></span>
                  <span x-show="d.is_significant" class="px-1.5 py-0.5 bg-red-100 text-red-600 rounded text-xs font-bold">重要</span>
                  <span class="px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-xs" x-text="fmt.diffType(d.diff_type)"></span></div>
                <div class="grid grid-cols-3 gap-4 mt-2 text-sm">
                  <div><span class="text-xs text-gray-400">旧金額</span><div class="font-mono" x-text="fmt.yen(d.old_amount)"></div></div>
                  <div><span class="text-xs text-gray-400">新金額</span><div class="font-mono" x-text="fmt.yen(d.new_amount)"></div></div>
                  <div><span class="text-xs text-gray-400">変動</span><div class="font-mono font-semibold" :class="d.change_amount > 0 ? 'text-red-600' : 'text-green-600'"><span x-text="(d.change_amount > 0 ? '+' : '') + fmt.yen(d.change_amount)"></span></div></div>
                </div></div>
                <div class="flex-shrink-0 ml-4"><div x-show="d.resolution_status === 'pending'" class="flex flex-col gap-1.5">
                  <button @click="resolveDiff(d.id, 'adopt_candidate')" class="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"><i class="fas fa-check mr-1"></i>新値採用</button>
                  <button @click="resolveDiff(d.id, 'keep_current')" class="px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium"><i class="fas fa-arrow-left mr-1"></i>旧値維持</button>
                  <button @click="resolveDiff(d.id, 'dismiss')" class="px-3 py-1.5 text-xs bg-yellow-100 text-yellow-700 rounded-lg hover:bg-yellow-200 font-medium"><i class="fas fa-ban mr-1"></i>却下</button>
                  <button @click="openManualAdjust(d)" class="px-3 py-1.5 text-xs bg-orange-100 text-orange-700 rounded-lg hover:bg-orange-200 font-medium"><i class="fas fa-sliders-h mr-1"></i>手動調整</button></div>
                  <div x-show="d.resolution_status !== 'pending'" class="text-center"><span class="px-2.5 py-1 text-xs rounded-full font-semibold"
                    :class="{'bg-blue-100 text-blue-700':d.resolution_status==='adopted','bg-gray-200 text-gray-600':d.resolution_status==='kept','bg-yellow-100 text-yellow-600':d.resolution_status==='dismissed','bg-orange-100 text-orange-700':d.resolution_status==='manual_adjusted'}" x-text="d.resolution_status"></span></div></div>
              </div></div>
          </template>
        </div>
        <!-- Manual Adjust Modal -->
        <div x-show="manualAdjust.show" x-cloak class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" @click.self="manualAdjust.show=false">
          <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 slide-in" @click.stop>
            <h3 class="font-bold mb-3"><i class="fas fa-sliders-h mr-2 text-orange-600"></i>手動金額調整</h3>
            <div class="bg-gray-50 rounded-lg p-3 mb-4 text-sm"><div class="font-medium" x-text="manualAdjust.diff?.item_name"></div></div>
            <div><label class="block text-xs font-medium text-gray-500 mb-1">調整後金額</label><input x-model.number="manualAdjust.amount" type="number" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500"></div>
            <div class="flex justify-end gap-2 mt-4"><button @click="manualAdjust.show=false" class="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">キャンセル</button>
              <button @click="submitManualAdjust()" class="px-4 py-2 text-sm bg-orange-600 text-white rounded-lg hover:bg-orange-700 font-medium">確定</button></div>
          </div>
        </div>
      </div>

      <!-- TAB 4: Cost Summary -->
      <div x-show="activeTab === 'summary'" class="fade-in">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
          <div class="bg-white rounded-xl border p-4 text-center"><div class="text-xs text-gray-500 mb-1">原価合計</div><div class="text-xl font-bold text-gray-800" x-text="fmt.yen(snapshot?.total_cost)"></div></div>
          <div class="bg-white rounded-xl border p-4 text-center"><div class="text-xs text-gray-500 mb-1">標準原価</div><div class="text-xl font-bold text-blue-700" x-text="fmt.yen(snapshot?.total_standard_cost)"></div></div>
          <div class="bg-white rounded-xl border p-4 text-center"><div class="text-xs text-gray-500 mb-1">太陽光原価</div><div class="text-xl font-bold text-yellow-600" x-text="fmt.yen(snapshot?.total_solar_cost)"></div></div>
          <div class="bg-white rounded-xl border p-4 text-center"><div class="text-xs text-gray-500 mb-1">オプション原価</div><div class="text-xl font-bold text-purple-600" x-text="fmt.yen(snapshot?.total_option_cost)"></div></div>
        </div>
        <div class="bg-white rounded-xl shadow-sm border overflow-hidden"><table class="min-w-full divide-y divide-gray-200"><thead class="bg-gray-50"><tr>
          <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500">カテゴリ</th><th class="px-4 py-3 text-right text-xs font-semibold text-gray-500">自動合計</th>
          <th class="px-4 py-3 text-right text-xs font-semibold text-gray-500">手動調整</th><th class="px-4 py-3 text-right text-xs font-semibold text-gray-500">最終合計</th><th class="px-4 py-3 text-right text-xs font-semibold text-gray-500">構成比</th>
        </tr></thead><tbody class="divide-y divide-gray-100">
          <template x-for="s in summaries" :key="s.category_code"><tr class="hover:bg-gray-50 text-sm">
            <td class="px-4 py-3"><span class="font-medium text-gray-800" x-text="s.category_code"></span></td>
            <td class="px-4 py-3 text-right text-gray-500 font-mono" x-text="fmt.yen(s.auto_total_amount)"></td>
            <td class="px-4 py-3 text-right font-mono" :class="s.manual_adjustment_amount ? 'text-orange-600 font-semibold' : 'text-gray-300'" x-text="fmt.yen(s.manual_adjustment_amount || 0)"></td>
            <td class="px-4 py-3 text-right font-mono font-semibold text-gray-800" x-text="fmt.yen(s.final_total_amount)"></td>
            <td class="px-4 py-3 text-right"><div class="flex items-center justify-end gap-2">
              <div class="w-16 bg-gray-200 rounded-full h-1.5"><div class="bg-hm-500 h-1.5 rounded-full" :style="'width:' + (snapshot?.total_cost ? Math.round(s.final_total_amount / snapshot.total_cost * 100) : 0) + '%'"></div></div>
              <span class="text-xs text-gray-400 w-10 text-right" x-text="snapshot?.total_cost ? Math.round(s.final_total_amount / snapshot.total_cost * 100) + '%' : '-'"></span></div></td>
          </tr></template>
        </tbody></table></div>
      </div>

      <!-- TAB 5: Sales Estimate -->
      <div x-show="activeTab === 'sales'" class="fade-in space-y-5">
        <div class="bg-white rounded-xl border p-5"><h3 class="font-semibold mb-3"><i class="fas fa-yen-sign mr-1.5 text-hm-600"></i>売価見積もり登録</h3>
          <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div><label class="block text-xs font-medium text-gray-500 mb-1">種別</label><select x-model="salesForm.estimate_type" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"><option value="rough">概算</option><option value="internal">社内</option><option value="contract">契約</option><option value="execution">実行</option></select></div>
            <div><label class="block text-xs font-medium text-gray-500 mb-1">売価合計</label><input x-model.number="salesForm.total_sale_price" type="number" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="0"></div>
            <div><label class="block text-xs font-medium text-gray-500 mb-1">標準売価</label><input x-model.number="salesForm.standard_sale" type="number" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"></div>
            <div><label class="block text-xs font-medium text-gray-500 mb-1">太陽光売価</label><input x-model.number="salesForm.solar_sale" type="number" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"></div>
            <div class="flex items-end"><button @click="createSalesEstimate()" class="w-full bg-hm-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-hm-700 font-medium" :disabled="salesSaving"><span x-show="!salesSaving"><i class="fas fa-paper-plane mr-1"></i>登録</span><span x-show="salesSaving"><i class="fas fa-spinner fa-spin"></i></span></button></div>
          </div>
        </div>
        <!-- Gap Analysis -->
        <div x-show="gap" class="bg-white rounded-xl border p-5">
          <h3 class="font-semibold mb-3"><i class="fas fa-chart-bar mr-1.5 text-blue-600"></i>乖離分析</h3>
          <div class="grid grid-cols-2 md:grid-cols-6 gap-4 mb-3">
            <div><div class="text-xs text-gray-500">原価合計</div><div class="text-lg font-bold font-mono" x-text="fmt.yen(gap?.total_cost)"></div></div>
            <div><div class="text-xs text-gray-500">売価合計</div><div class="text-lg font-bold font-mono" x-text="fmt.yen(gap?.total_sale_price)"></div></div>
            <div><div class="text-xs text-gray-500">差額</div><div class="text-lg font-bold font-mono" :class="gap?.gap_amount >= 0 ? 'text-green-600' : 'text-red-600'" x-text="fmt.yen(gap?.gap_amount)"></div></div>
            <div><div class="text-xs text-gray-500">粗利率</div><div class="text-lg font-bold" :class="gap?.overall_margin_rate >= 25 ? 'text-green-600' : gap?.overall_margin_rate >= 15 ? 'text-yellow-600' : 'text-red-600'" x-text="fmt.pct(gap?.overall_margin_rate)"></div></div>
            <div><div class="text-xs text-gray-500">乖離率</div><div class="text-lg font-bold font-mono" :class="gap?.margin_deviation > 0 ? 'text-red-600' : 'text-green-600'" x-text="(gap?.margin_deviation > 0 ? '+' : '') + fmt.pct(gap?.margin_deviation)"></div></div>
            <div><div class="text-xs text-gray-500">判定</div>
              <span class="px-3 py-1 rounded-full text-sm font-bold" :class="{'bg-green-100 text-green-700':gap?.severity==='ok','bg-yellow-100 text-yellow-700':gap?.severity==='warning','bg-red-100 text-red-700':gap?.severity==='error'}" x-text="gap?.severity==='ok' ? 'OK' : gap?.severity==='warning' ? '注意' : 'NG'"></span></div>
          </div>
          <!-- Severity Explanation -->
          <div x-show="gap?.severity_reason" class="mt-3 p-3 rounded-lg text-sm" :class="{'bg-green-50 border border-green-200 text-green-800':gap?.severity==='ok','bg-yellow-50 border border-yellow-200 text-yellow-800':gap?.severity==='warning','bg-red-50 border border-red-200 text-red-800':gap?.severity==='error'}">
            <i class="fas fa-info-circle mr-1"></i><span x-text="gap?.severity_reason"></span>
            <div class="text-xs mt-1 opacity-75">期待粗利率: <span x-text="gap?.expected_margin_rate"></span>% / 警告閾値: <span x-text="gap?.thresholds?.sales_gap_warning_threshold"></span>% / エラー閾値: <span x-text="gap?.thresholds?.sales_gap_error_threshold"></span>%</div>
          </div>
          <div class="grid grid-cols-3 gap-3 mt-3 border-t pt-3">
            <template x-for="g in [{key:'standard_gap', label:'標準'},{key:'solar_gap', label:'太陽光'},{key:'option_gap', label:'オプション'}]" :key="g.key"><div class="text-xs">
              <div class="font-medium text-gray-700 mb-1" x-text="g.label"></div>
              <div class="flex justify-between"><span class="text-gray-400">原価</span><span class="font-mono" x-text="fmt.yen(gap?.[g.key]?.cost)"></span></div>
              <div class="flex justify-between"><span class="text-gray-400">売価</span><span class="font-mono" x-text="fmt.yen(gap?.[g.key]?.sale)"></span></div>
              <div class="flex justify-between"><span class="text-gray-400">粗利</span><span class="font-mono font-semibold" :class="gap?.[g.key]?.actual_margin >= gap?.[g.key]?.expected_margin ? 'text-green-600' : 'text-red-600'" x-text="fmt.pct(gap?.[g.key]?.actual_margin)"></span></div>
            </div></template>
          </div>
        </div>
        <!-- Estimate History -->
        <div x-show="salesEstimates.length > 0" class="bg-white rounded-xl border overflow-hidden">
          <h3 class="font-semibold p-4 pb-2"><i class="fas fa-history mr-1.5 text-gray-500"></i>見積履歴</h3>
          <table class="min-w-full divide-y divide-gray-200"><thead class="bg-gray-50"><tr>
            <th class="px-4 py-2 text-left text-xs font-medium text-gray-500">種別</th><th class="px-4 py-2 text-right text-xs font-medium text-gray-500">売価</th>
            <th class="px-4 py-2 text-right text-xs font-medium text-gray-500">粗利率</th><th class="px-4 py-2 text-center text-xs font-medium text-gray-500">現行</th><th class="px-4 py-2 text-left text-xs font-medium text-gray-500">日時</th>
          </tr></thead><tbody class="divide-y divide-gray-100"><template x-for="e in salesEstimates" :key="e.id"><tr class="text-sm hover:bg-gray-50">
            <td class="px-4 py-2"><span class="px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700" x-text="fmt.estimateType(e.estimate_type)"></span></td>
            <td class="px-4 py-2 text-right font-mono" x-text="fmt.yen(e.total_sale_price)"></td>
            <td class="px-4 py-2 text-right font-mono" :class="e.gross_margin_rate >= 25 ? 'text-green-600' : 'text-red-600'" x-text="fmt.pct(e.gross_margin_rate)"></td>
            <td class="px-4 py-2 text-center"><i x-show="e.is_current" class="fas fa-check text-green-500"></i></td>
            <td class="px-4 py-2 text-gray-400 text-xs" x-text="fmt.datetime(e.created_at)"></td>
          </tr></template></tbody></table>
        </div>
      </div>

      <!-- TAB 6: AI & Warnings (Production Hardened) -->
      <div x-show="activeTab === 'ai'" class="fade-in space-y-5">
        <!-- AI Status Card -->
        <div class="bg-white rounded-xl border p-4 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-full flex items-center justify-center" :class="aiStatus?.ai_available ? 'bg-purple-100' : 'bg-gray-100'">
              <i class="fas fa-robot" :class="aiStatus?.ai_available ? 'text-purple-600' : 'text-gray-400'"></i></div>
            <div><div class="font-semibold text-sm" x-text="aiStatus?.phase === 'phase_1_production' ? 'AI Phase 1 (Production)' : 'AI Phase 1'"></div>
              <div class="text-xs" :class="aiStatus?.ai_available ? 'text-green-600' : 'text-yellow-600'">
                <i class="fas fa-circle text-xs mr-1 pulse-dot" :class="aiStatus?.ai_available ? 'text-green-500' : 'text-yellow-500'"></i>
                <span x-text="aiStatus?.ai_available ? 'AI接続済 (OpenAI)' : 'ルールベース分析モード（APIキー未設定）'"></span></div>
              <div x-show="aiStatus?.fallback_reason" class="text-xs text-gray-400 mt-0.5" x-text="aiStatus?.fallback_reason"></div>
            </div>
          </div>
          <div class="flex gap-2">
            <button @click="runAiCheck()" class="px-3 py-1.5 text-xs bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition font-medium" :disabled="aiChecking">
              <span x-show="!aiChecking"><i class="fas fa-search mr-1"></i>条件チェック</span><span x-show="aiChecking"><i class="fas fa-spinner fa-spin"></i></span></button>
          </div>
        </div>

        <!-- Degradation Notice -->
        <div x-show="aiStatus && !aiStatus.ai_available" class="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
          <div class="flex items-start gap-3"><i class="fas fa-info-circle text-yellow-500 mt-0.5"></i>
            <div><div class="font-medium text-yellow-800 text-sm">グレースフルデグレードモード</div>
              <div class="text-xs text-yellow-700 mt-1">OPENAI_API_KEYが未設定のため、全AI機能はルールベースで動作しています。条件チェック・理由分類・帳票読取は利用可能ですが、AI固有の高度分析は無効です。APIキーを設定するとAI機能が自動的に有効化されます。</div></div></div>
        </div>

        <!-- AI Check Results -->
        <div x-show="aiCheckResult" class="bg-white rounded-xl border p-5">
          <h3 class="font-semibold mb-3"><i class="fas fa-clipboard-list mr-1.5 text-purple-600"></i>AI条件チェック結果</h3>
          <div class="flex gap-3 mb-3 flex-wrap text-xs">
            <span class="px-2 py-1 bg-gray-100 rounded">モード: <span class="font-semibold" x-text="aiCheckResult?.mode"></span></span>
            <span class="px-2 py-1 bg-gray-100 rounded">ルール: <span class="font-semibold" x-text="aiCheckResult?.total_rules_checked"></span></span>
            <span class="px-2 py-1 bg-orange-100 text-orange-700 rounded">未達: <span class="font-semibold" x-text="aiCheckResult?.unmet_count"></span></span>
            <span x-show="aiCheckResult?.warnings_persisted > 0" class="px-2 py-1 bg-purple-100 text-purple-700 rounded">警告保存: <span class="font-semibold" x-text="aiCheckResult?.warnings_persisted"></span></span>
          </div>
          <div class="space-y-2 max-h-80 overflow-y-auto">
            <template x-for="u in (aiCheckResult?.unmet_conditions || []).slice(0, 20)" :key="u.rule_id + '_' + u.field">
              <div class="p-3 border rounded-lg text-xs" :class="{'bg-orange-50 border-orange-100':u.severity==='warning','bg-blue-50 border-blue-100':u.severity==='info','bg-red-50 border-red-100':u.severity==='error'}">
                <div class="flex items-center gap-2 mb-1"><i :class="fmt.severityIcon(u.severity)"></i>
                  <span class="font-medium text-gray-800" x-text="u.suggestion"></span>
                  <span class="px-1.5 py-0.5 rounded text-xs" :class="fmt.confidenceBg(u.confidence_level)" x-text="'信頼度: ' + fmt.confidenceLabel(u.confidence_level)"></span></div>
                <div class="text-gray-500 mt-0.5">ルール: <span x-text="u.rule_name"></span> (<span x-text="u.rule_group"></span>) / アクション: <span x-text="u.suggested_action"></span></div></div>
            </template>
          </div>
        </div>

        <!-- Persisted Warnings (with read/resolve) -->
        <div class="bg-white rounded-xl border p-5">
          <div class="flex justify-between items-center mb-3">
            <h3 class="font-semibold"><i class="fas fa-bell mr-1.5 text-yellow-500"></i>警告管理 (<span x-text="aiWarnings?.summary?.open || warnings.filter(w => w.status === 'open').length"></span>)</h3>
            <div class="flex gap-2 text-xs">
              <button @click="loadAiWarnings('open')" class="px-2 py-1 rounded" :class="warningFilter === 'open' ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-500'">未解決</button>
              <button @click="loadAiWarnings('resolved')" class="px-2 py-1 rounded" :class="warningFilter === 'resolved' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'">解決済</button>
              <button @click="loadAiWarnings('')" class="px-2 py-1 rounded" :class="warningFilter === '' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'">全件</button>
            </div>
          </div>
          <div x-show="aiWarningsList.length === 0" class="py-6 text-center text-gray-400 text-sm"><i class="fas fa-check-circle text-green-400 text-2xl mb-2"></i><p>警告はありません</p></div>
          <div class="space-y-2 max-h-96 overflow-y-auto">
            <template x-for="w in aiWarningsList" :key="w.id">
              <div class="p-3 rounded-lg border text-sm flex items-start gap-3"
                :class="{'bg-red-50 border-red-200':w.severity==='error'&&w.status==='open','bg-yellow-50 border-yellow-200':w.severity==='warning'&&w.status==='open','bg-blue-50 border-blue-200':w.severity==='info'&&w.status==='open','bg-gray-50 border-gray-200':w.status!=='open'}"
                :style="w.status !== 'open' ? 'opacity: 0.6' : ''">
                <i :class="fmt.severityIcon(w.severity)" class="mt-0.5"></i>
                <div class="flex-1 min-w-0">
                  <div class="font-medium text-gray-800" x-text="w.message"></div>
                  <div class="text-xs text-gray-500 mt-0.5 flex gap-2 flex-wrap">
                    <span x-text="w.warning_type"></span><span x-text="w.source"></span>
                    <span x-show="w.recommendation" class="text-blue-600" x-text="w.recommendation"></span>
                    <span x-show="!w.is_read" class="text-purple-600 font-medium">●未読</span>
                    <span x-show="w.status === 'resolved'" class="text-green-600">✓解決済</span>
                    <span x-show="w.status === 'ignored'" class="text-gray-500">–無視</span></div></div>
                <div x-show="w.status === 'open'" class="flex gap-1 flex-shrink-0">
                  <button @click="updateWarning(w.id, 'mark_read')" x-show="!w.is_read" class="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded hover:bg-gray-200" title="既読"><i class="fas fa-eye"></i></button>
                  <button @click="updateWarning(w.id, 'resolve')" class="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200" title="解決"><i class="fas fa-check"></i></button>
                  <button @click="updateWarning(w.id, 'ignore')" class="px-2 py-1 text-xs bg-gray-100 text-gray-500 rounded hover:bg-gray-200" title="無視"><i class="fas fa-eye-slash"></i></button></div>
                <div x-show="w.status !== 'open'" class="flex-shrink-0">
                  <button @click="updateWarning(w.id, 'reopen')" class="px-2 py-1 text-xs bg-yellow-100 text-yellow-700 rounded hover:bg-yellow-200" title="再オープン"><i class="fas fa-undo"></i></button></div>
              </div>
            </template>
          </div>
        </div>

        <!-- PDF Parse Section -->
        <div class="bg-white rounded-xl border p-5">
          <h3 class="font-semibold mb-3"><i class="fas fa-file-pdf mr-1.5 text-red-500"></i>帳票読取（PDF/テキスト）</h3>
          <div class="mb-3"><textarea x-model="parseContent" rows="4" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500" placeholder="帳票のテキスト内容を貼り付けてください..."></textarea></div>
          <div class="flex gap-3 items-center">
            <select x-model="parseFormat" class="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"><option value="text">テキスト</option><option value="csv">CSV</option></select>
            <button @click="parseDocument()" class="px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 font-medium" :disabled="parsing">
              <span x-show="!parsing"><i class="fas fa-magic mr-1"></i>読取実行</span><span x-show="parsing"><i class="fas fa-spinner fa-spin"></i></span></button>
            <span x-show="parseResult" class="text-xs text-gray-500">
              <span x-text="parseResult?.items_extracted || 0"></span> 件抽出 / 信頼度: <span :class="fmt.confidenceColor(parseResult?.extraction_quality?.confidence_level)" x-text="fmt.confidenceLabel(parseResult?.extraction_quality?.confidence_level)"></span></span>
          </div>
          <!-- Parse Results -->
          <div x-show="parseResult?.extracted_items?.length > 0" class="mt-4">
            <div class="flex justify-between items-center mb-2"><h4 class="text-sm font-medium text-gray-700">抽出結果（確認が必要です）</h4>
              <span class="text-xs text-gray-400">合計: <span class="font-mono" x-text="fmt.yen(parseResult?.total_amount)"></span></span></div>
            <div class="bg-purple-50 border border-purple-200 rounded-lg p-3 mb-3 text-xs text-purple-800">
              <i class="fas fa-info-circle mr-1"></i><span x-text="parseResult?.verification_note || '抽出結果を確認してください'"></span></div>
            <div class="overflow-x-auto"><table class="min-w-full text-xs divide-y divide-gray-200"><thead class="bg-gray-50"><tr>
              <th class="px-2 py-1.5 text-left">行</th><th class="px-2 py-1.5 text-left">項目名</th><th class="px-2 py-1.5 text-right">数量</th><th class="px-2 py-1.5 text-right">単価</th><th class="px-2 py-1.5 text-right">金額</th><th class="px-2 py-1.5 text-center">信頼度</th>
            </tr></thead><tbody class="divide-y divide-gray-100"><template x-for="item in parseResult?.extracted_items || []" :key="item.line_no">
              <tr class="hover:bg-gray-50"><td class="px-2 py-1.5 text-gray-400" x-text="item.line_no"></td>
                <td class="px-2 py-1.5 font-medium" x-text="item.item_name"></td>
                <td class="px-2 py-1.5 text-right font-mono"><span x-text="item.quantity || '-'"></span> <span class="text-gray-400" x-text="item.unit || ''"></span></td>
                <td class="px-2 py-1.5 text-right font-mono" x-text="item.unit_price ? fmt.yen(item.unit_price) : '-'"></td>
                <td class="px-2 py-1.5 text-right font-mono font-semibold" x-text="fmt.yen(item.amount)"></td>
                <td class="px-2 py-1.5 text-center"><span class="px-1.5 py-0.5 rounded text-xs" :class="fmt.confidenceBg(item.confidence_level)" x-text="fmt.confidenceLabel(item.confidence_level)"></span></td>
              </tr></template></tbody></table></div>
          </div>
        </div>
      </div>

      <!-- Regenerate Modal -->
      <div x-show="showRegenModal" x-cloak class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" @click.self="showRegenModal=false">
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 slide-in" @click.stop>
          <h2 class="text-lg font-bold mb-4"><i class="fas fa-sync-alt mr-2 text-blue-600"></i>スナップショット再計算</h2>
          <div class="space-y-3">
            <label class="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-blue-50 transition" :class="regenMode === 'regenerate_preserve_reviewed' ? 'border-blue-500 bg-blue-50' : ''"><input type="radio" x-model="regenMode" value="regenerate_preserve_reviewed" class="mt-1"><div><div class="font-medium text-sm">レビュー済保持</div><div class="text-xs text-gray-500">確認済みの項目は保持し、それ以外を再計算</div></div></label>
            <label class="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-blue-50 transition" :class="regenMode === 'regenerate_auto_only' ? 'border-blue-500 bg-blue-50' : ''"><input type="radio" x-model="regenMode" value="regenerate_auto_only" class="mt-1"><div><div class="font-medium text-sm">自動項目のみ</div><div class="text-xs text-gray-500">手修正項目は保持し、自動計算項目のみ再計算</div></div></label>
            <label class="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-red-50 transition" :class="regenMode === 'regenerate_replace_all' ? 'border-red-500 bg-red-50' : ''"><input type="radio" x-model="regenMode" value="regenerate_replace_all" class="mt-1"><div><div class="font-medium text-sm text-red-700">全件置換</div><div class="text-xs text-gray-500">全項目を最新マスタで再計算（管理者のみ）</div></div></label>
          </div>
          <div class="flex justify-end gap-2 mt-5"><button @click="showRegenModal=false" class="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">キャンセル</button>
            <button @click="executeRegen()" class="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium" :disabled="enqueueing"><span x-show="!enqueueing"><i class="fas fa-play mr-1"></i>実行</span><span x-show="enqueueing"><i class="fas fa-spinner fa-spin mr-1"></i>実行中...</span></button></div>
        </div>
      </div>

      <!-- Toast -->
      <div x-show="toast.show" x-cloak x-transition class="fixed bottom-5 right-5 z-50 max-w-sm">
        <div class="rounded-xl shadow-lg px-4 py-3 flex items-center gap-3" :class="{'bg-green-600 text-white':toast.type==='success','bg-red-600 text-white':toast.type==='error','bg-gray-800 text-white':toast.type==='info'}">
          <i :class="{'fas fa-check-circle':toast.type==='success','fas fa-exclamation-circle':toast.type==='error','fas fa-info-circle':toast.type==='info'}"></i>
          <span class="text-sm" x-text="toast.message"></span></div>
      </div>
    </div>

    <script>
    function projectDetail(projectId) {
      return {
        project: null, snapshot: null, items: [], summaries: [], diffs: [], diffMeta: null,
        risk: null, gap: null, warnings: [], salesEstimates: [],
        aiStatus: null, aiCheckResult: null, aiWarningsList: [], aiWarnings: null,
        loading: true, enqueueing: false, salesSaving: false, aiChecking: false, diffsLoading: false, parsing: false,
        activeTab: 'risk', showRegenModal: false, regenMode: 'regenerate_preserve_reviewed',
        toast: { show: false, message: '', type: 'info' },
        itemSearch: '', itemReviewFilter: '', diffFilter: '', warningFilter: 'open',
        parseContent: '', parseFormat: 'text', parseResult: null,
        editModal: { show:false, item:null, saving:false, error:'',
          form: { manual_quantity:null, manual_unit_price:null, manual_amount:null, override_reason_category:'', override_reason:'', note:'', review_status:'', vendor_name:'' } },
        manualAdjust: { show:false, diff:null, amount:0 },
        salesForm: { estimate_type:'rough', total_sale_price:0, standard_sale:0, solar_sale:0 },
        tabs: [
          { id:'risk', label:'リスクセンター', icon:'fas fa-shield-alt', badge:0, badgeColor:'bg-red-500 text-white' },
          { id:'edit', label:'案件情報', icon:'fas fa-edit', badge:0, badgeColor:'' },
          { id:'items', label:'工種明細', icon:'fas fa-list-alt', badge:0, badgeColor:'bg-gray-200 text-gray-600' },
          { id:'diffs', label:'差分解決', icon:'fas fa-code-compare', badge:0, badgeColor:'bg-orange-500 text-white' },
          { id:'summary', label:'原価サマリ', icon:'fas fa-chart-pie', badge:0, badgeColor:'' },
          { id:'sales', label:'売価見積', icon:'fas fa-yen-sign', badge:0, badgeColor:'' },
          { id:'ai', label:'AI・警告', icon:'fas fa-robot', badge:0, badgeColor:'bg-purple-500 text-white' },
        ],
        statusClass(s) { return {'draft':'bg-gray-100 text-gray-600','calculating':'bg-indigo-100 text-indigo-700','in_progress':'bg-blue-100 text-blue-700','needs_review':'bg-yellow-100 text-yellow-700','reviewed':'bg-green-100 text-green-700','archived':'bg-purple-100 text-purple-600'}[s] || 'bg-gray-100 text-gray-600'; },
        async init() { await this.loadAll(); this.loading = false; },
        async loadAll() {
          const pRes = await api.get('/projects/' + projectId);
          if (pRes.success) this.project = pRes.data;
          if (this.project?.current_snapshot_id) {
            const sRes = await api.get('/projects/' + projectId + '/snapshots/' + this.project.current_snapshot_id);
            if (sRes.success) { this.snapshot = sRes.data.snapshot; this.items = sRes.data.items || []; this.summaries = sRes.data.summaries || []; this.warnings = sRes.data.warnings || []; }
            await this.loadDiffs();
            const gRes = await api.get('/projects/' + projectId + '/gap-analysis');
            if (gRes.success && gRes.data.has_estimate) this.gap = gRes.data.gap_analysis;
            const seRes = await api.get('/projects/' + projectId + '/sales-estimates');
            if (seRes.success) this.salesEstimates = seRes.data || [];
          }
          const rRes = await api.get('/projects/' + projectId + '/risk-centre');
          if (rRes.success) this.risk = rRes.data;
          const aiRes = await api.get('/ai/status');
          if (aiRes.success) this.aiStatus = aiRes.data;
          await this.loadAiWarnings(this.warningFilter);
          this.updateBadges();
        },
        async loadDiffs() {
          this.diffsLoading = true; let q = '';
          if (this.diffFilter === 'pending') q = '?status=pending'; else if (this.diffFilter === 'significant') q = '?significant_only=true';
          const dRes = await api.get('/projects/' + projectId + '/diffs' + q);
          if (dRes.success) { this.diffs = dRes.data || []; this.diffMeta = dRes.meta || { total: this.diffs.length, pending: 0, significant: 0, resolved: 0 }; }
          this.diffsLoading = false;
        },
        async loadAiWarnings(status) {
          this.warningFilter = status;
          const q = status ? '?status=' + status : '';
          const res = await api.get('/ai/warnings/' + projectId + q);
          if (res.success) { this.aiWarningsList = res.data || []; this.aiWarnings = res.summary || null; }
        },
        updateBadges() {
          this.tabs[0].badge = this.risk?.summary?.action_required_count || 0;
          this.tabs[2].badge = this.items.length;
          this.tabs[3].badge = this.diffMeta?.pending || 0;
          this.tabs[6].badge = (this.aiWarnings?.open || this.warnings.filter(w => w.status === 'open').length);
        },
        onTabChange(tabId) {},
        editSaving: false, editError: '',
        async saveProjectEdit(field, value) {
          this.editSaving = true; this.editError = '';
          const body = {}; body[field] = value;
          const res = await api.patch('/projects/' + projectId, body);
          this.editSaving = false;
          if (res.success) { this.project = res.data; this.showToast('「' + field + '」を更新しました', 'success'); }
          else { this.editError = res.error || '更新に失敗しました'; this.showToast('エラー: ' + (res.error||''), 'error'); }
        },
        async saveProjectBatch(fields) {
          this.editSaving = true; this.editError = '';
          const body = {};
          for (const [k, v] of Object.entries(fields)) { body[k] = v === '' ? null : v; }
          const res = await api.patch('/projects/' + projectId, body);
          this.editSaving = false;
          if (res.success) { this.project = res.data; this.showToast(Object.keys(fields).length + '項目を更新しました', 'success'); }
          else { this.editError = res.error || '更新に失敗しました'; this.showToast('エラー: ' + (res.error||''), 'error'); }
        },
        filteredItems() { let r = this.items; if(this.itemSearch){const q=this.itemSearch.toLowerCase();r=r.filter(i=>(i.item_name||'').toLowerCase().includes(q)||(i.category_code||'').toLowerCase().includes(q));} if(this.itemReviewFilter){r=r.filter(i=>i.review_status===this.itemReviewFilter);} return r; },
        openEditModal(item) { this.editModal.item = item; this.editModal.form = { manual_quantity:item.manual_quantity, manual_unit_price:item.manual_unit_price, manual_amount:item.manual_amount, override_reason_category:item.override_reason_category||'', override_reason:item.override_reason||'', note:item.note||'', review_status:'', vendor_name:item.vendor_name||'' }; this.editModal.error=''; this.editModal.show=true; },
        async saveItemEdit() {
          this.editModal.saving=true; this.editModal.error=''; const body={}; const f=this.editModal.form;
          if(f.manual_quantity!==this.editModal.item.manual_quantity) body.manual_quantity=f.manual_quantity;
          if(f.manual_unit_price!==this.editModal.item.manual_unit_price) body.manual_unit_price=f.manual_unit_price;
          if(f.manual_amount!==this.editModal.item.manual_amount) body.manual_amount=f.manual_amount;
          if(f.override_reason_category) body.override_reason_category=f.override_reason_category;
          if(f.override_reason) body.override_reason=f.override_reason;
          if(f.note!==(this.editModal.item.note||'')) body.note=f.note;
          if(f.review_status) body.review_status=f.review_status;
          if(f.vendor_name!==(this.editModal.item.vendor_name||'')) body.vendor_name=f.vendor_name;
          if(!Object.keys(body).length){this.editModal.error='変更がありません';this.editModal.saving=false;return;}
          const res=await api.patch('/projects/'+projectId+'/cost-items/'+this.editModal.item.id, body); this.editModal.saving=false;
          if(res.success){this.editModal.show=false;this.showToast('保存しました','success');await this.loadAll();}else{this.editModal.error=res.error||'保存に失敗しました';}
        },
        async enqueue(jobType) { this.enqueueing=true; const res=await api.post('/projects/'+projectId+'/snapshots/enqueue',{job_type:jobType}); this.enqueueing=false; if(res.success){this.showToast('計算が完了しました','success');await this.loadAll();}else{this.showToast('エラー: '+(res.error||''),'error');} },
        async executeRegen() { this.showRegenModal=false; await this.enqueue(this.regenMode); },
        async resolveDiff(diffId, action) { const res=await api.post('/projects/'+projectId+'/diffs/'+diffId+'/resolve',{action}); if(res.success){this.showToast('差分を解決しました','success');await this.loadAll();}else{this.showToast('エラー: '+(res.error||''),'error');} },
        openManualAdjust(diff) { this.manualAdjust.diff=diff; this.manualAdjust.amount=diff.new_amount||diff.old_amount||0; this.manualAdjust.show=true; },
        async submitManualAdjust() { const res=await api.post('/projects/'+projectId+'/diffs/'+this.manualAdjust.diff.id+'/resolve',{action:'manual_adjust',manual_amount:this.manualAdjust.amount}); this.manualAdjust.show=false; if(res.success){this.showToast('手動調整を適用しました','success');await this.loadAll();}else{this.showToast('エラー: '+(res.error||''),'error');} },
        async createSalesEstimate() { this.salesSaving=true; const res=await api.post('/projects/'+projectId+'/sales-estimates',this.salesForm); this.salesSaving=false; if(res.success){this.showToast('売価見積もりを登録しました','success');this.gap=res.data?.gap_analysis;await this.loadAll();}else{this.showToast('エラー: '+(res.error||''),'error');} },
        async runAiCheck() { this.aiChecking=true; const res=await api.post('/ai/check-conditions',{project_id:projectId,persist_warnings:true}); this.aiChecking=false; if(res.success){this.aiCheckResult=res.data;this.showToast('AI条件チェック完了','success');await this.loadAiWarnings(this.warningFilter);}else{this.showToast('エラー: '+(res.error||''),'error');} },
        async updateWarning(warningId, action) { const res=await api.patch('/ai/warnings/'+warningId,{action}); if(res.success){this.showToast(res.message||'更新しました','success');await this.loadAiWarnings(this.warningFilter);await this.loadAll();}else{this.showToast('エラー: '+(res.error||''),'error');} },
        async parseDocument() { if(!this.parseContent.trim()){this.showToast('テキストを入力してください','error');return;} this.parsing=true; const res=await api.post('/ai/parse-document',{content:this.parseContent,format:this.parseFormat,context:{project_id:projectId}}); this.parsing=false; if(res.success){this.parseResult=res.data;this.showToast(res.data.items_extracted+'件抽出しました','success');}else{this.showToast('エラー: '+(res.error||''),'error');} },
        showToast(message, type='info') { this.toast={show:true,message,type}; setTimeout(()=>{this.toast.show=false;},3500); },
      };
    }
    </script>
  `, 'projects'));
});


// ==========================================================
// /ui/login — Login Page
// ==========================================================
uiRoutes.get('/ui/login', (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ログイン - 平松建築 原価管理</title>
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
<script>tailwind.config={theme:{extend:{colors:{hm:{50:'#f0fdf4',100:'#dcfce7',500:'#22c55e',600:'#16a34a',700:'#15803d',800:'#166534'}}}}}</script>
</head>
<body class="bg-gradient-to-br from-hm-50 to-gray-100 min-h-screen flex items-center justify-center" x-data="loginForm()" x-init="checkAuth()">
  <div class="bg-white rounded-2xl shadow-xl w-full max-w-md p-8 mx-4">
    <div class="text-center mb-8">
      <div class="w-16 h-16 bg-hm-100 rounded-full flex items-center justify-center mx-auto mb-4"><i class="fas fa-building text-hm-600 text-2xl"></i></div>
      <h1 class="text-2xl font-bold text-gray-800">平松建築</h1>
      <p class="text-sm text-gray-500 mt-1">概算原価管理システム</p>
    </div>
    <div class="space-y-4">
      <div><label class="block text-xs font-medium text-gray-500 mb-1">メールアドレス</label>
        <div class="relative"><i class="fas fa-envelope absolute left-3 top-3 text-gray-400 text-sm"></i>
          <input x-model="email" type="email" class="w-full border border-gray-300 rounded-lg pl-10 pr-3 py-2.5 text-sm focus:ring-2 focus:ring-hm-500 focus:border-transparent" placeholder="user@hiramatsu.example.com" @keydown.enter="login()"></div></div>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">パスワード</label>
        <div class="relative"><i class="fas fa-lock absolute left-3 top-3 text-gray-400 text-sm"></i>
          <input x-model="password" type="password" class="w-full border border-gray-300 rounded-lg pl-10 pr-3 py-2.5 text-sm focus:ring-2 focus:ring-hm-500 focus:border-transparent" placeholder="パスワード" @keydown.enter="login()"></div></div>
      <button @click="login()" class="w-full bg-hm-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-hm-700 transition shadow-sm" :disabled="loading">
        <span x-show="!loading"><i class="fas fa-sign-in-alt mr-1"></i>ログイン</span>
        <span x-show="loading"><i class="fas fa-spinner fa-spin mr-1"></i>認証中...</span>
      </button>
      <div x-show="error" class="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600"><i class="fas fa-exclamation-circle mr-1"></i><span x-text="error"></span></div>
      <div class="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700">
        <i class="fas fa-info-circle mr-1"></i><strong>初回ログイン</strong>：管理者から通知されたメールアドレスで、任意のパスワード（4文字以上）を設定してください。そのパスワードが今後のログインに使われます。
      </div>
    </div>
    <div class="mt-6 pt-4 border-t text-center text-xs text-gray-400">v0.9.0 | <a href="/ui/manual" class="text-hm-600 hover:underline">使い方ガイド</a></div>
  </div>
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
  <script>
  function loginForm() {
    return {
      email: '', password: '', error: '', loading: false,
      async checkAuth() {
        try { const r = await fetch('/api/auth/me'); const d = await r.json(); if (d.success) location.href = '/ui/projects'; } catch {}
      },
      async login() {
        if (!this.email || !this.password) { this.error = 'メールアドレスとパスワードを入力してください'; return; }
        this.loading = true; this.error = '';
        try {
          const r = await fetch('/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email:this.email,password:this.password}) });
          const d = await r.json();
          if (d.success) { location.href = '/ui/projects'; } else { this.error = d.error || 'ログインに失敗しました'; }
        } catch(e) { this.error = '通信エラーが発生しました'; }
        this.loading = false;
      }
    };
  }
  </script>
</body></html>`);
});

// ==========================================================
// /ui/admin — Admin Dashboard (User Management + Master Items)
// ==========================================================
uiRoutes.get('/ui/admin', (c) => {
  return c.html(layout('管理画面', `
    <div x-data="adminPanel()" x-init="init()">
      <div class="flex justify-between items-center mb-6">
        <div><h1 class="text-2xl font-bold text-gray-800"><i class="fas fa-cog mr-2 text-hm-600"></i>管理画面</h1>
          <p class="text-sm text-gray-500 mt-1">ユーザー管理・マスタ設定</p></div>
      </div>

      <!-- Admin Tabs -->
      <div class="flex border-b mb-5 bg-white rounded-t-xl overflow-x-auto">
        <button @click="tab='users'" class="px-4 py-3 text-sm font-medium border-b-2 transition whitespace-nowrap" :class="tab==='users' ? 'border-hm-600 text-hm-700 bg-hm-50/50' : 'border-transparent text-gray-500 hover:text-gray-700'"><i class="fas fa-users mr-1.5"></i>ユーザー管理</button>
        <button @click="tab='master'" class="px-4 py-3 text-sm font-medium border-b-2 transition whitespace-nowrap" :class="tab==='master' ? 'border-hm-600 text-hm-700 bg-hm-50/50' : 'border-transparent text-gray-500 hover:text-gray-700'"><i class="fas fa-database mr-1.5"></i>単価マスタ</button>
        <button @click="tab='settings'" class="px-4 py-3 text-sm font-medium border-b-2 transition whitespace-nowrap" :class="tab==='settings' ? 'border-hm-600 text-hm-700 bg-hm-50/50' : 'border-transparent text-gray-500 hover:text-gray-700'"><i class="fas fa-sliders-h mr-1.5"></i>システム設定</button>
      </div>

      <!-- TAB: Users -->
      <div x-show="tab==='users'" class="fade-in space-y-4">
        <div class="flex justify-between items-center">
          <div class="text-sm text-gray-500"><span x-text="users.length"></span> 名のユーザー</div>
          <button @click="showCreateUser=true" class="bg-hm-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-hm-700 transition shadow-sm"><i class="fas fa-plus mr-1"></i>ユーザー追加</button>
        </div>
        <div class="bg-white rounded-xl shadow-sm border overflow-hidden"><div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-200"><thead class="bg-gray-50"><tr>
            <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500">名前</th>
            <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500">メール</th>
            <th class="px-4 py-3 text-center text-xs font-semibold text-gray-500">権限</th>
            <th class="px-4 py-3 text-center text-xs font-semibold text-gray-500">状態</th>
            <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500">最終ログイン</th>
            <th class="px-4 py-3 text-center text-xs font-semibold text-gray-500">操作</th>
          </tr></thead><tbody class="divide-y divide-gray-100">
            <template x-for="u in users" :key="u.id"><tr class="hover:bg-gray-50 text-sm">
              <td class="px-4 py-3 font-medium text-gray-800" x-text="u.name"></td>
              <td class="px-4 py-3 text-gray-500 text-xs font-mono" x-text="u.email"></td>
              <td class="px-4 py-3 text-center"><span class="px-2 py-0.5 text-xs rounded-full font-medium" :class="{'bg-red-100 text-red-700':u.role==='admin','bg-blue-100 text-blue-700':u.role==='manager','bg-green-100 text-green-700':u.role==='estimator','bg-gray-100 text-gray-600':u.role==='viewer'}" x-text="roleLabel(u.role)"></span></td>
              <td class="px-4 py-3 text-center"><span class="px-2 py-0.5 text-xs rounded-full font-medium" :class="u.status==='active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'" x-text="u.status==='active' ? '有効' : '無効'"></span></td>
              <td class="px-4 py-3 text-xs text-gray-400" x-text="u.last_login_at ? fmt.datetime(u.last_login_at) : '未ログイン'"></td>
              <td class="px-4 py-3 text-center"><button @click="openEditUser(u)" class="text-hm-600 hover:text-hm-800 mr-2"><i class="fas fa-pen"></i></button>
                <button @click="deleteUser(u)" x-show="u.status==='active'" class="text-red-400 hover:text-red-600"><i class="fas fa-trash"></i></button></td>
            </tr></template>
          </tbody></table></div>
        </div>

        <!-- Create User Modal -->
        <div x-show="showCreateUser" x-cloak class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" @click.self="showCreateUser=false">
          <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 slide-in" @click.stop>
            <h2 class="text-lg font-bold mb-4"><i class="fas fa-user-plus mr-2 text-hm-600"></i>ユーザー追加</h2>
            <div class="space-y-3">
              <div><label class="block text-xs font-medium text-gray-500 mb-1">名前 <span class="text-red-400">*</span></label><input x-model="userForm.name" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500" placeholder="山田太郎"></div>
              <div><label class="block text-xs font-medium text-gray-500 mb-1">メールアドレス <span class="text-red-400">*</span></label><input x-model="userForm.email" type="email" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500" placeholder="yamada@hiramatsu.co.jp"></div>
              <div class="grid grid-cols-2 gap-3">
                <div><label class="block text-xs font-medium text-gray-500 mb-1">権限 <span class="text-red-400">*</span></label><select x-model="userForm.role" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500">
                  <option value="estimator">見積担当</option><option value="manager">管理者</option><option value="admin">システム管理</option><option value="viewer">閲覧者</option></select></div>
                <div><label class="block text-xs font-medium text-gray-500 mb-1">初期パスワード</label><input x-model="userForm.password" type="password" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500" placeholder="4文字以上"></div>
              </div>
              <div><label class="block text-xs font-medium text-gray-500 mb-1">部署</label><input x-model="userForm.department" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500" placeholder="設計部"></div>
            </div>
            <div class="bg-blue-50 border border-blue-200 rounded-lg p-2 mt-3 text-xs text-blue-700"><i class="fas fa-info-circle mr-1"></i>パスワード未設定の場合、ユーザーが初回ログイン時に自分で設定します。</div>
            <div class="flex justify-end gap-2 mt-4"><button @click="showCreateUser=false" class="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">キャンセル</button>
              <button @click="createUser()" class="px-5 py-2 text-sm bg-hm-600 text-white rounded-lg hover:bg-hm-700 font-medium" :disabled="userSaving"><span x-show="!userSaving"><i class="fas fa-check mr-1"></i>作成</span><span x-show="userSaving"><i class="fas fa-spinner fa-spin"></i></span></button></div>
            <div x-show="userError" class="mt-2 p-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600" x-text="userError"></div>
          </div>
        </div>

        <!-- Edit User Modal -->
        <div x-show="editUserModal.show" x-cloak class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" @click.self="editUserModal.show=false">
          <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 slide-in" @click.stop>
            <h2 class="text-lg font-bold mb-4"><i class="fas fa-user-edit mr-2 text-hm-600"></i>ユーザー編集</h2>
            <div class="space-y-3">
              <div><label class="block text-xs font-medium text-gray-500 mb-1">名前</label><input x-model="editUserModal.form.name" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500"></div>
              <div class="grid grid-cols-2 gap-3">
                <div><label class="block text-xs font-medium text-gray-500 mb-1">権限</label><select x-model="editUserModal.form.role" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500">
                  <option value="admin">システム管理</option><option value="manager">管理者</option><option value="estimator">見積担当</option><option value="viewer">閲覧者</option></select></div>
                <div><label class="block text-xs font-medium text-gray-500 mb-1">状態</label><select x-model="editUserModal.form.status" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500">
                  <option value="active">有効</option><option value="inactive">無効</option><option value="suspended">停止</option></select></div>
              </div>
              <div><label class="block text-xs font-medium text-gray-500 mb-1">パスワード再設定</label><input x-model="editUserModal.form.password" type="password" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500" placeholder="変更しない場合は空欄"></div>
            </div>
            <div class="flex justify-end gap-2 mt-4"><button @click="editUserModal.show=false" class="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">キャンセル</button>
              <button @click="updateUser()" class="px-5 py-2 text-sm bg-hm-600 text-white rounded-lg hover:bg-hm-700 font-medium" :disabled="userSaving"><span x-show="!userSaving"><i class="fas fa-save mr-1"></i>保存</span><span x-show="userSaving"><i class="fas fa-spinner fa-spin"></i></span></button></div>
            <div x-show="userError" class="mt-2 p-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600" x-text="userError"></div>
          </div>
        </div>

        <!-- Role explanation -->
        <div class="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm">
          <h3 class="font-bold text-blue-800 mb-2"><i class="fas fa-shield-alt mr-1"></i>権限の説明</h3>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div class="bg-white rounded-lg p-3 border"><span class="font-bold text-red-700">admin</span><br>全機能利用可。ユーザー管理、マスタ変更、全案件閲覧。</div>
            <div class="bg-white rounded-lg p-3 border"><span class="font-bold text-blue-700">manager</span><br>全案件閲覧・レビュー。ユーザー一覧閲覧可。マスタ変更不可。</div>
            <div class="bg-white rounded-lg p-3 border"><span class="font-bold text-green-700">estimator</span><br>自分の案件を作成・管理。他者の案件は閲覧不可。</div>
            <div class="bg-white rounded-lg p-3 border"><span class="font-bold text-gray-600">viewer</span><br>自分に割り当てられた案件のみ閲覧可能。編集不可。</div>
          </div>
        </div>
      </div>

      <!-- TAB: Master Items -->
      <div x-show="tab==='master'" class="fade-in space-y-4">
        <div class="bg-white rounded-xl border p-5">
          <div class="flex justify-between items-center mb-3">
            <div>
              <h3 class="font-semibold"><i class="fas fa-database mr-1.5 text-hm-600"></i>単価マスタ管理</h3>
              <p class="text-sm text-gray-500 mt-1">各工種のデフォルト単価を確認・変更できます。変更した単価は次回の再計算時に反映されます。</p>
            </div>
            <button @click="openMasterCreate()" class="bg-hm-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-hm-700 transition shadow-sm whitespace-nowrap">
              <i class="fas fa-plus mr-1.5"></i>新規工種追加
            </button>
          </div>
          <div class="flex flex-wrap gap-2 mb-4">
            <input x-model="masterSearch" class="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-64 focus:ring-2 focus:ring-hm-500" placeholder="工種名・カテゴリで検索...">
            <select x-model="masterCategory" @change="loadMasterItems()" class="border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
              <option value="">全カテゴリ</option>
              <template x-for="cat in categories" :key="cat.category_code"><option :value="cat.category_code" x-text="cat.category_name"></option></template>
            </select>
          </div>
          <div class="overflow-x-auto"><table class="min-w-full divide-y divide-gray-200"><thead class="bg-gray-50"><tr>
            <th class="px-3 py-2.5 text-left text-xs font-semibold text-gray-500">カテゴリ</th>
            <th class="px-3 py-2.5 text-left text-xs font-semibold text-gray-500">工種名</th>
            <th class="px-3 py-2.5 text-left text-xs font-semibold text-gray-500">計算方法</th>
            <th class="px-3 py-2.5 text-right text-xs font-semibold text-gray-500">単価</th>
            <th class="px-3 py-2.5 text-right text-xs font-semibold text-gray-500">固定額</th>
            <th class="px-3 py-2.5 text-left text-xs font-semibold text-gray-500">単位</th>
            <th class="px-3 py-2.5 text-center text-xs font-semibold text-gray-500">操作</th>
          </tr></thead><tbody class="divide-y divide-gray-100">
            <template x-for="item in filteredMasterItems()" :key="item.id"><tr class="hover:bg-gray-50 text-sm">
              <td class="px-3 py-2 text-xs"><span class="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded" x-text="catName(item.category_code)"></span></td>
              <td class="px-3 py-2 font-medium text-gray-800 max-w-xs truncate" x-text="item.item_name"></td>
              <td class="px-3 py-2 text-xs"><span class="px-1.5 py-0.5 bg-gray-100 rounded" x-text="calcLabel(item.calculation_type)"></span></td>
              <td class="px-3 py-2 text-right font-mono text-sm" :class="{'text-hm-700 font-semibold': item.base_unit_price}" x-text="item.base_unit_price != null ? fmt.yen(item.base_unit_price) : '-'"></td>
              <td class="px-3 py-2 text-right font-mono text-sm" :class="{'text-orange-600 font-semibold': item.base_fixed_amount}" x-text="item.base_fixed_amount != null ? fmt.yen(item.base_fixed_amount) : '-'"></td>
              <td class="px-3 py-2 text-xs text-gray-500" x-text="item.unit || '-'"></td>
              <td class="px-3 py-2 text-center"><button @click="openMasterEdit(item)" class="text-hm-600 hover:text-hm-800 p-1" title="編集"><i class="fas fa-pen"></i></button></td>
            </tr></template>
          </tbody></table></div>
          <div x-show="masterItems.length === 0 && !masterLoading" class="py-8 text-center text-gray-400"><i class="fas fa-database text-3xl mb-2"></i><p>マスタアイテムがありません</p></div>
          <div x-show="masterLoading" class="py-8 text-center text-gray-400"><i class="fas fa-spinner fa-spin text-2xl mb-2"></i><p>読み込み中...</p></div>
          <div class="mt-2 text-xs text-gray-400" x-text="filteredMasterItems().length + ' / ' + masterItems.length + ' 件表示'"></div>
        </div>

        <!-- Master Edit Modal -->
        <div x-show="masterEditModal.show" x-cloak class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" @click.self="masterEditModal.show=false">
          <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 slide-in" @click.stop>
            <h2 class="text-lg font-bold mb-2"><i class="fas fa-pen mr-2 text-hm-600"></i>単価変更</h2>
            <div class="bg-gray-50 rounded-lg p-3 mb-4 text-sm"><span class="font-mono text-xs text-gray-400" x-text="(masterEditModal.item?.category_code||'') + ' / ' + (masterEditModal.item?.item_code||'')"></span><div class="font-bold text-gray-800 mt-1" x-text="masterEditModal.item?.item_name"></div></div>
            <div class="space-y-3">
              <div class="grid grid-cols-2 gap-3">
                <div><label class="block text-xs font-medium text-gray-500 mb-1">デフォルト単価 (円)</label>
                  <input type="number" step="1" :value="masterEditModal.form.base_unit_price" @input="masterEditModal.form.base_unit_price = $event.target.value === '' ? null : Number($event.target.value)" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500" placeholder="例: 35000"></div>
                <div><label class="block text-xs font-medium text-gray-500 mb-1">固定額 (円)</label>
                  <input type="number" step="1" :value="masterEditModal.form.base_fixed_amount" @input="masterEditModal.form.base_fixed_amount = $event.target.value === '' ? null : Number($event.target.value)" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500" placeholder="例: 500000"></div>
              </div>
              <div class="grid grid-cols-2 gap-3">
                <div><label class="block text-xs font-medium text-gray-500 mb-1">単位</label>
                  <input type="text" x-model="masterEditModal.form.unit" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500" placeholder="例: m2, 坪, kW"></div>
                <div><label class="block text-xs font-medium text-gray-500 mb-1">業者名</label>
                  <input type="text" x-model="masterEditModal.form.vendor_name" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500" placeholder="例: ABC建設"></div>
              </div>
              <div><label class="block text-xs font-medium text-gray-500 mb-1">備考</label>
                <textarea x-model="masterEditModal.form.note" rows="2" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500" placeholder="メモや補足情報"></textarea></div>
            </div>
            <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-2 mt-3 text-xs text-yellow-700"><i class="fas fa-exclamation-triangle mr-1"></i>単価の変更は既存案件には影響しません。変更後に案件を「再計算」すると新しい単価が反映されます。</div>
            <div class="flex justify-end gap-2 mt-4"><button @click="masterEditModal.show=false" class="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">キャンセル</button>
              <button @click="saveMasterItem()" class="px-5 py-2 text-sm bg-hm-600 text-white rounded-lg hover:bg-hm-700 font-medium" :disabled="masterSaving"><span x-show="!masterSaving"><i class="fas fa-save mr-1"></i>保存</span><span x-show="masterSaving"><i class="fas fa-spinner fa-spin"></i></span></button></div>
            <div x-show="masterError" class="mt-2 p-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600" x-text="masterError"></div>
          </div>
        </div>

        <!-- Master Create Modal -->
        <div x-show="masterCreateModal.show" x-cloak class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" @click.self="masterCreateModal.show=false">
          <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 slide-in" @click.stop>
            <h2 class="text-lg font-bold mb-4"><i class="fas fa-plus-circle mr-2 text-hm-600"></i>新規工種追加</h2>
            <div class="space-y-3">
              <div class="grid grid-cols-2 gap-3">
                <div><label class="block text-xs font-medium text-gray-500 mb-1">カテゴリ <span class="text-red-400">*</span></label>
                  <select x-model="masterCreateModal.form.category_code" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500">
                    <option value="">選択してください</option>
                    <template x-for="cat in categories" :key="cat.category_code"><option :value="cat.category_code" x-text="cat.category_name"></option></template>
                  </select></div>
                <div><label class="block text-xs font-medium text-gray-500 mb-1">工種コード <span class="text-red-400">*</span></label>
                  <input type="text" x-model="masterCreateModal.form.item_code" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500" placeholder="例: foundation_custom"></div>
              </div>
              <div><label class="block text-xs font-medium text-gray-500 mb-1">工種名 <span class="text-red-400">*</span></label>
                <input type="text" x-model="masterCreateModal.form.item_name" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500" placeholder="例: 基礎工事 特殊仕様"></div>
              <div class="grid grid-cols-2 gap-3">
                <div><label class="block text-xs font-medium text-gray-500 mb-1">計算方法</label>
                  <select x-model="masterCreateModal.form.calculation_type" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500">
                    <option value="per_m2">面積(m2)ベース</option><option value="per_tsubo">坪ベース</option><option value="per_meter">mベース</option>
                    <option value="per_piece">個ベース</option><option value="range_lookup">範囲参照</option><option value="fixed_amount">固定額</option>
                    <option value="lineup_fixed">ラインナップ固定</option><option value="rule_lookup">ルール参照</option><option value="manual_quote">手動見積</option>
                    <option value="product_selection">商品選択</option><option value="package_with_delta">パッケージ</option><option value="threshold_surcharge">閾値加算</option>
                  </select></div>
                <div><label class="block text-xs font-medium text-gray-500 mb-1">単位</label>
                  <input type="text" x-model="masterCreateModal.form.unit" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500" placeholder="例: m2, 坪, kW"></div>
              </div>
              <div class="grid grid-cols-2 gap-3">
                <div><label class="block text-xs font-medium text-gray-500 mb-1">デフォルト単価 (円)</label>
                  <input type="number" step="1" :value="masterCreateModal.form.base_unit_price" @input="masterCreateModal.form.base_unit_price = $event.target.value === '' ? null : Number($event.target.value)" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500" placeholder="例: 35000"></div>
                <div><label class="block text-xs font-medium text-gray-500 mb-1">固定額 (円)</label>
                  <input type="number" step="1" :value="masterCreateModal.form.base_fixed_amount" @input="masterCreateModal.form.base_fixed_amount = $event.target.value === '' ? null : Number($event.target.value)" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500" placeholder="例: 500000"></div>
              </div>
              <div class="grid grid-cols-2 gap-3">
                <div><label class="block text-xs font-medium text-gray-500 mb-1">業者名</label>
                  <input type="text" x-model="masterCreateModal.form.vendor_name" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500"></div>
                <div><label class="block text-xs font-medium text-gray-500 mb-1">セクション区分</label>
                  <select x-model="masterCreateModal.form.section_type" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500">
                    <option value="basic">基本工事</option><option value="extra">追加工事</option>
                  </select></div>
              </div>
              <div><label class="block text-xs font-medium text-gray-500 mb-1">備考</label>
                <textarea x-model="masterCreateModal.form.note" rows="2" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500" placeholder="メモや補足情報"></textarea></div>
            </div>
            <div class="flex justify-end gap-2 mt-4"><button @click="masterCreateModal.show=false" class="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">キャンセル</button>
              <button @click="createMasterItem()" class="px-5 py-2 text-sm bg-hm-600 text-white rounded-lg hover:bg-hm-700 font-medium" :disabled="masterSaving"><span x-show="!masterSaving"><i class="fas fa-plus mr-1"></i>追加</span><span x-show="masterSaving"><i class="fas fa-spinner fa-spin"></i></span></button></div>
            <div x-show="masterError" class="mt-2 p-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600" x-text="masterError"></div>
          </div>
        </div>
      </div>

      <!-- TAB: System Settings -->
      <div x-show="tab==='settings'" class="fade-in space-y-4">
        <div class="bg-white rounded-xl border p-5">
          <h3 class="font-semibold mb-3"><i class="fas fa-sliders-h mr-1.5 text-hm-600"></i>システム設定</h3>
          <p class="text-sm text-gray-500 mb-4">粗利率の閾値やデフォルト値を変更できます。</p>
          <div class="space-y-3">
            <template x-for="s in settings" :key="s.setting_key">
              <div class="flex items-center gap-4 p-3 bg-gray-50 rounded-lg">
                <div class="flex-1"><div class="font-medium text-sm text-gray-800" x-text="s.description || s.setting_key"></div>
                  <div class="text-xs text-gray-400 font-mono" x-text="s.setting_key"></div></div>
                <input :type="s.value_type === 'boolean' ? 'text' : 'text'" :value="s.setting_value" @change="updateSetting(s.setting_key, $event.target.value)" class="w-32 border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-right font-mono focus:ring-2 focus:ring-hm-500">
              </div>
            </template>
          </div>
          <div x-show="settings.length === 0" class="py-6 text-center text-gray-400">設定がありません</div>
        </div>
      </div>

      <!-- Toast -->
      <div x-show="toast.show" x-cloak x-transition class="fixed bottom-5 right-5 z-50 max-w-sm">
        <div class="rounded-xl shadow-lg px-4 py-3 flex items-center gap-3" :class="{'bg-green-600 text-white':toast.type==='success','bg-red-600 text-white':toast.type==='error'}">
          <i :class="{'fas fa-check-circle':toast.type==='success','fas fa-exclamation-circle':toast.type==='error'}"></i>
          <span class="text-sm" x-text="toast.message"></span></div>
      </div>
    </div>
    <script>
    function adminPanel() {
      return {
        tab: 'users', users: [], settings: [], categories: [], masterItems: [], masterLoading: false, masterSearch: '', masterCategory: '',
        showCreateUser: false, userSaving: false, userError: '',
        userForm: { name:'', email:'', role:'estimator', password:'', department:'' },
        editUserModal: { show:false, user:null, form:{ name:'', role:'', status:'', password:'' } },
        masterEditModal: { show:false, item:null, form:{ base_unit_price:null, base_fixed_amount:null, unit:'', vendor_name:'', note:'' } },
        masterCreateModal: { show:false, form:{ category_code:'', item_code:'', item_name:'', calculation_type:'area_based', unit:'', base_unit_price:null, base_fixed_amount:null, vendor_name:'', section_type:'basic', note:'' } },
        masterSaving: false, masterError: '',
        toast: { show:false, message:'', type:'info' },
        roleLabel(r) { return {admin:'管理者',manager:'マネージャー',estimator:'見積担当',viewer:'閲覧者'}[r]||r; },
        catName(code) { const c = this.categories.find(c=>c.category_code===code); return c ? c.category_name : code; },
        calcLabel(t) { return {per_m2:'面積(m2)ベース',per_tsubo:'坪ベース',per_meter:'mベース',per_piece:'個ベース',range_lookup:'範囲参照',fixed_amount:'固定額',lineup_fixed:'ラインナップ固定',rule_lookup:'ルール参照',manual_quote:'手動見積',product_selection:'商品選択',package_with_delta:'パッケージ',threshold_surcharge:'閾値加算'}[t]||t; },
        showToast(msg, type='success') { this.toast={show:true,message:msg,type}; setTimeout(()=>{this.toast.show=false;},3000); },
        async init() {
          await Promise.all([this.loadUsers(), this.loadSettings(), this.loadCategories(), this.loadMasterItems()]);
        },
        async loadUsers() { const r = await api.get('/admin/users'); if(r.success) this.users = r.data || []; },
        async loadSettings() { const r = await api.get('/master/system-settings'); if(r.success) this.settings = r.data || []; },
        async loadCategories() { const r = await api.get('/master/categories'); if(r.success) this.categories = r.data || []; },
        async loadMasterItems() {
          this.masterLoading = true;
          const q = this.masterCategory ? '?category=' + this.masterCategory : '';
          const r = await api.get('/master/items' + q); if(r.success) this.masterItems = r.data || [];
          this.masterLoading = false;
        },
        filteredMasterItems() {
          if (!this.masterSearch) return this.masterItems;
          const q = this.masterSearch.toLowerCase();
          return this.masterItems.filter(i => (i.item_name||'').toLowerCase().includes(q) || (i.category_code||'').toLowerCase().includes(q) || (i.item_code||'').toLowerCase().includes(q));
        },
        async createUser() {
          this.userSaving=true; this.userError='';
          const body = {...this.userForm}; if(!body.password) delete body.password; if(!body.department) delete body.department;
          const r = await api.post('/admin/users', body); this.userSaving=false;
          if(r.success) { this.showCreateUser=false; this.showToast('ユーザーを作成しました'); this.userForm={name:'',email:'',role:'estimator',password:'',department:''}; await this.loadUsers(); }
          else { this.userError = r.error || '作成に失敗しました'; }
        },
        openEditUser(u) { this.editUserModal.user = u; this.editUserModal.form = { name:u.name, role:u.role, status:u.status, password:'' }; this.userError=''; this.editUserModal.show=true; },
        async updateUser() {
          this.userSaving=true; this.userError='';
          const body = {}; const f = this.editUserModal.form; const u = this.editUserModal.user;
          if(f.name !== u.name) body.name = f.name;
          if(f.role !== u.role) body.role = f.role;
          if(f.status !== u.status) body.status = f.status;
          if(f.password) body.password = f.password;
          if(!Object.keys(body).length) { this.userError='変更がありません'; this.userSaving=false; return; }
          const r = await api.patch('/admin/users/' + u.id, body); this.userSaving=false;
          if(r.success) { this.editUserModal.show=false; this.showToast('ユーザーを更新しました'); await this.loadUsers(); }
          else { this.userError = r.error || '更新に失敗しました'; }
        },
        async deleteUser(u) { if(!confirm(u.name + ' を無効化しますか？')) return;
          const r = await api.del('/admin/users/' + u.id);
          if(r.success) { this.showToast('ユーザーを無効化しました'); await this.loadUsers(); } else { this.showToast(r.error||'エラー','error'); }
        },
        openMasterEdit(item) { this.masterEditModal.item = item; this.masterEditModal.form = { base_unit_price:item.base_unit_price, base_fixed_amount:item.base_fixed_amount, unit:item.unit||'', vendor_name:item.vendor_name||'', note:item.note||'' }; this.masterError=''; this.masterEditModal.show=true; },
        async saveMasterItem() {
          this.masterSaving=true; this.masterError='';
          const item = this.masterEditModal.item;
          const form = {...this.masterEditModal.form};
          const r = await api.patch('/master/items/' + item.id, form);
          this.masterSaving=false;
          if(r.success) { this.masterEditModal.show=false; this.showToast('単価を更新しました'); await this.loadMasterItems(); }
          else { this.masterError = r.error || '更新に失敗しました'; }
        },
        openMasterCreate() { this.masterCreateModal.form = { category_code:'', item_code:'', item_name:'', calculation_type:'per_m2', unit:'', base_unit_price:null, base_fixed_amount:null, vendor_name:'', section_type:'basic', note:'' }; this.masterError=''; this.masterCreateModal.show=true; },
        async createMasterItem() {
          this.masterSaving=true; this.masterError='';
          const form = {...this.masterCreateModal.form};
          if(!form.category_code || !form.item_code || !form.item_name) { this.masterError='カテゴリ、工種コード、工種名は必須です'; this.masterSaving=false; return; }
          const r = await api.post('/master/items', form);
          this.masterSaving=false;
          if(r.success) { this.masterCreateModal.show=false; this.showToast('新規工種を追加しました'); await this.loadMasterItems(); }
          else { this.masterError = r.error || '追加に失敗しました'; }
        },
        async updateSetting(key, value) {
          const r = await api.patch('/master/system-settings/' + key, { setting_value: value });
          if(r.success) { this.showToast('設定を更新しました'); await this.loadSettings(); }
          else { this.showToast(r.error || '更新に失敗しました', 'error'); }
        },
      };
    }
    </script>
  `, 'admin'));
});

// ==========================================================
// /ui/manual — User Manual Page (Completely Rewritten v2)
// ==========================================================
uiRoutes.get('/ui/manual', (c) => {
  return c.html(layout('使い方ガイド', `
    <div class="max-w-4xl mx-auto">

      <!-- Hero / Quick Start -->
      <div class="bg-gradient-to-br from-hm-600 to-hm-800 rounded-2xl p-6 md:p-8 mb-8 text-white">
        <h1 class="text-2xl md:text-3xl font-bold mb-2"><i class="fas fa-book-open mr-2"></i>使い方ガイド</h1>
        <p class="text-hm-100 text-sm md:text-base mb-5">平松建築 概算原価管理システム -- 初めての方はここから</p>
        <div class="bg-white/15 backdrop-blur rounded-xl p-5">
          <h2 class="font-bold text-base mb-3"><i class="fas fa-bolt mr-1"></i>3分で分かるクイックスタート</h2>
          <div class="grid grid-cols-1 md:grid-cols-5 gap-3 text-center text-xs md:text-sm">
            <div class="bg-white/20 rounded-lg p-3">
              <div class="text-2xl mb-1"><i class="fas fa-plus-circle"></i></div>
              <div class="font-bold">STEP 1</div>
              <div class="text-hm-100">案件を作る</div>
              <div class="text-hm-200 text-xs mt-1">案件名・ラインナップ<br>坪数を入力</div>
            </div>
            <div class="bg-white/20 rounded-lg p-3">
              <div class="text-2xl mb-1"><i class="fas fa-pencil-alt"></i></div>
              <div class="font-bold">STEP 2</div>
              <div class="text-hm-100">建物情報を入力</div>
              <div class="text-hm-200 text-xs mt-1">「案件情報」タブで<br>面積・仕様を入力</div>
            </div>
            <div class="bg-white/20 rounded-lg p-3">
              <div class="text-2xl mb-1"><i class="fas fa-calculator"></i></div>
              <div class="font-bold">STEP 3</div>
              <div class="text-hm-100">初期計算</div>
              <div class="text-hm-200 text-xs mt-1">緑の「初期計算」ボタン<br>→58工種を自動算出</div>
            </div>
            <div class="bg-white/20 rounded-lg p-3">
              <div class="text-2xl mb-1"><i class="fas fa-edit"></i></div>
              <div class="font-bold">STEP 4</div>
              <div class="text-hm-100">個別に修正</div>
              <div class="text-hm-200 text-xs mt-1">「工種明細」タブで<br>1つずつ見積を調整</div>
            </div>
            <div class="bg-white/20 rounded-lg p-3">
              <div class="text-2xl mb-1"><i class="fas fa-chart-pie"></i></div>
              <div class="font-bold">STEP 5</div>
              <div class="text-hm-100">売価と比較</div>
              <div class="text-hm-200 text-xs mt-1">「売価見積」タブで<br>粗利を確認</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Important: Sheet vs System -->
      <section class="bg-orange-50 border-2 border-orange-300 rounded-xl p-6 mb-6">
        <h2 class="text-lg font-bold text-orange-800 mb-3"><i class="fas fa-exchange-alt mr-2"></i>元のシートとの違い（必ず読んでください）</h2>
        <div class="text-sm text-gray-700 space-y-3">
          <p>元の Excel シートでは、<strong>工種ごとに別のタブ</strong>を開いて1つずつ見積入力していましたが、本システムでは<strong>まず一括自動計算</strong>してから、<strong>必要な工種だけ個別に修正する</strong>流れに変わっています。</p>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
            <div class="bg-white rounded-lg p-4 border border-orange-200">
              <h3 class="font-bold text-red-600 text-sm mb-2"><i class="fas fa-file-excel mr-1"></i>元のシート（旧）</h3>
              <ol class="list-decimal list-inside text-xs space-y-1 text-gray-600">
                <li>「基礎工事」タブを開いて見積入力</li>
                <li>「上棟費」タブを開いて見積入力</li>
                <li>「外壁」タブを開いて見積入力</li>
                <li>...58工種を1つずつ手入力</li>
                <li>合計を手動計算</li>
              </ol>
              <p class="text-xs text-red-500 mt-2 font-medium">全部手入力 = 時間がかかる</p>
            </div>
            <div class="bg-white rounded-lg p-4 border border-green-200">
              <h3 class="font-bold text-green-600 text-sm mb-2"><i class="fas fa-laptop-code mr-1"></i>本システム（新）</h3>
              <ol class="list-decimal list-inside text-xs space-y-1 text-gray-600">
                <li>建物情報（坪数・面積等）を入力</li>
                <li>「初期計算」ボタン1回クリック</li>
                <li><strong>58工種が全自動で算出</strong></li>
                <li>業者見積や仕様変更がある工種だけ個別修正</li>
                <li>合計・粗利は自動計算</li>
              </ol>
              <p class="text-xs text-green-600 mt-2 font-medium">大部分は自動 = 速い＆正確</p>
            </div>
          </div>
          <div class="bg-orange-100 rounded-lg p-3 mt-3 text-xs">
            <i class="fas fa-lightbulb text-orange-600 mr-1"></i><strong>ポイント</strong>：自動算出された金額がそのまま使えるケースが多いです。業者からの見積書が届いた工種など、<strong>実際の金額がわかっている工種だけ</strong>手動修正すればOKです。
          </div>
        </div>
      </section>

      <!-- TOC -->
      <div class="bg-gray-50 rounded-xl border p-5 mb-8">
        <h2 class="text-sm font-bold text-gray-700 mb-3"><i class="fas fa-list-ol mr-1"></i>目次</h2>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-1 text-sm">
          <a href="#login" class="text-hm-700 hover:text-hm-900 py-1 hover:bg-hm-50 px-2 rounded"><i class="fas fa-chevron-right text-xs mr-1"></i>0. ログインとユーザー管理</a>
          <a href="#step1" class="text-hm-700 hover:text-hm-900 py-1 hover:bg-hm-50 px-2 rounded"><i class="fas fa-chevron-right text-xs mr-1"></i>1. 案件を作成する</a>
          <a href="#step2" class="text-hm-700 hover:text-hm-900 py-1 hover:bg-hm-50 px-2 rounded"><i class="fas fa-chevron-right text-xs mr-1"></i>2. 建物情報を入力する</a>
          <a href="#step3" class="text-hm-700 hover:text-hm-900 py-1 hover:bg-hm-50 px-2 rounded"><i class="fas fa-chevron-right text-xs mr-1"></i>3. 初期計算を実行する</a>
          <a href="#step4" class="text-hm-700 hover:text-hm-900 py-1 hover:bg-hm-50 px-2 rounded"><i class="fas fa-chevron-right text-xs mr-1"></i>4. 個別の工種見積を修正する</a>
          <a href="#step5" class="text-hm-700 hover:text-hm-900 py-1 hover:bg-hm-50 px-2 rounded"><i class="fas fa-chevron-right text-xs mr-1"></i>5. 原価サマリを確認する</a>
          <a href="#step6" class="text-hm-700 hover:text-hm-900 py-1 hover:bg-hm-50 px-2 rounded"><i class="fas fa-chevron-right text-xs mr-1"></i>6. 売価見積もりとは（売価の意味と使い方）</a>
          <a href="#step7" class="text-hm-700 hover:text-hm-900 py-1 hover:bg-hm-50 px-2 rounded"><i class="fas fa-chevron-right text-xs mr-1"></i>7. リスクセンターで全体確認</a>
          <a href="#step8" class="text-hm-700 hover:text-hm-900 py-1 hover:bg-hm-50 px-2 rounded"><i class="fas fa-chevron-right text-xs mr-1"></i>8. 再計算と差分解決</a>
          <a href="#statuses" class="text-hm-700 hover:text-hm-900 py-1 hover:bg-hm-50 px-2 rounded"><i class="fas fa-chevron-right text-xs mr-1"></i>9. ステータスの意味と遷移</a>
          <a href="#tabs" class="text-hm-700 hover:text-hm-900 py-1 hover:bg-hm-50 px-2 rounded"><i class="fas fa-chevron-right text-xs mr-1"></i>10. 各タブの詳細ガイド</a>
          <a href="#master" class="text-hm-700 hover:text-hm-900 py-1 hover:bg-hm-50 px-2 rounded"><i class="fas fa-chevron-right text-xs mr-1"></i>11. 単価マスタの変更方法</a>
          <a href="#faq" class="text-hm-700 hover:text-hm-900 py-1 hover:bg-hm-50 px-2 rounded"><i class="fas fa-chevron-right text-xs mr-1"></i>12. よくある質問 (FAQ)</a>
          <a href="#terms" class="text-hm-700 hover:text-hm-900 py-1 hover:bg-hm-50 px-2 rounded"><i class="fas fa-chevron-right text-xs mr-1"></i>13. 用語集</a>
        </div>
      </div>

      <!-- LOGIN & USER MANAGEMENT -->
      <section id="login" class="bg-white rounded-xl border-2 border-blue-300 p-6 mb-5">
        <h2 class="text-lg font-bold text-gray-800 mb-3 flex items-center"><span class="bg-blue-600 text-white w-8 h-8 rounded-full flex items-center justify-center text-sm mr-3 flex-shrink-0">0</span>ログインとユーザー管理</h2>
        <div class="space-y-3 text-sm text-gray-600">
          <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h3 class="font-bold text-blue-800 mb-2"><i class="fas fa-sign-in-alt mr-1"></i>ログイン方法</h3>
            <ol class="list-decimal list-inside space-y-1 text-xs">
              <li><a href="/ui/login" class="text-blue-600 underline">/ui/login</a> にアクセス</li>
              <li>管理者から通知されたメールアドレスを入力</li>
              <li><strong>初回ログイン</strong>：任意のパスワード（4文字以上）を設定。以降はそのパスワードでログイン</li>
              <li>ログイン後、自動的に案件一覧へ遷移</li>
            </ol>
          </div>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div class="bg-red-50 border border-red-200 rounded-lg p-3"><strong class="text-red-700">admin</strong><br>全機能利用可。ユーザー追加・削除、マスタ変更、全案件閲覧。</div>
            <div class="bg-blue-50 border border-blue-200 rounded-lg p-3"><strong class="text-blue-700">manager</strong><br>全案件閲覧・レビュー。ユーザー一覧閲覧。</div>
            <div class="bg-green-50 border border-green-200 rounded-lg p-3"><strong class="text-green-700">estimator</strong><br>自分の案件を作成・管理。他者の案件は見えない。</div>
            <div class="bg-gray-50 border border-gray-200 rounded-lg p-3"><strong class="text-gray-600">viewer</strong><br>割当てられた案件のみ閲覧可能。</div>
          </div>
          <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-xs">
            <i class="fas fa-shield-alt text-yellow-600 mr-1"></i><strong>管理者向け</strong>：ユーザーの追加・権限変更は <a href="/ui/admin" class="text-hm-600 underline">管理画面</a>（ナビの「管理」）で行えます。
          </div>
        </div>
      </section>

      <!-- STEP 1 -->
      <section id="step1" class="bg-white rounded-xl border p-6 mb-5">
        <h2 class="text-lg font-bold text-gray-800 mb-3 flex items-center"><span class="bg-hm-600 text-white w-8 h-8 rounded-full flex items-center justify-center text-sm mr-3 flex-shrink-0">1</span>案件を作成する</h2>
        <div class="space-y-3 text-sm text-gray-600">
          <div class="flex items-start gap-3 bg-gray-50 rounded-lg p-3">
            <span class="bg-hm-600 text-white min-w-[28px] h-7 flex items-center justify-center rounded-lg text-xs font-bold flex-shrink-0">1</span>
            <div><a href="/ui/projects" class="text-hm-600 underline font-bold">案件一覧ページ</a>を開き、右上の緑ボタン「<strong class="text-hm-700">＋ 新規案件</strong>」をクリック</div>
          </div>
          <div class="flex items-start gap-3 bg-gray-50 rounded-lg p-3">
            <span class="bg-hm-600 text-white min-w-[28px] h-7 flex items-center justify-center rounded-lg text-xs font-bold flex-shrink-0">2</span>
            <div>ダイアログで以下を入力：
              <div class="grid grid-cols-3 gap-2 mt-2 text-xs">
                <div class="bg-white border rounded p-2"><strong>案件コード</strong> <span class="text-red-400">必須</span><br>例: 2026-001</div>
                <div class="bg-white border rounded p-2"><strong>案件名</strong> <span class="text-red-400">必須</span><br>例: 山田邸新築工事</div>
                <div class="bg-white border rounded p-2"><strong>ラインナップ</strong> <span class="text-red-400">必須</span><br>SHIN / RIN / MOKU</div>
              </div>
              <p class="text-xs text-gray-400 mt-2">坪数・面積・断熱等級・防火区分もここで入力できますが、後から「案件情報」タブで編集も可能です。</p>
            </div>
          </div>
          <div class="flex items-start gap-3 bg-gray-50 rounded-lg p-3">
            <span class="bg-hm-600 text-white min-w-[28px] h-7 flex items-center justify-center rounded-lg text-xs font-bold flex-shrink-0">3</span>
            <div>「<strong>作成</strong>」ボタンで案件の詳細画面に自動遷移します</div>
          </div>
        </div>
      </section>

      <!-- STEP 2 -->
      <section id="step2" class="bg-white rounded-xl border p-6 mb-5">
        <h2 class="text-lg font-bold text-gray-800 mb-3 flex items-center"><span class="bg-hm-600 text-white w-8 h-8 rounded-full flex items-center justify-center text-sm mr-3 flex-shrink-0">2</span>建物情報を入力する（「案件情報」タブ）</h2>
        <div class="space-y-3 text-sm text-gray-600">
          <p>案件詳細画面の <strong class="text-hm-700">「案件情報」タブ</strong>（タブ一覧の2番目）を開きます。</p>
          <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
            <i class="fas fa-lightbulb text-yellow-500 mr-1"></i><strong>重要</strong>：坪数・面積は原価自動計算の基礎データです。<strong>正確に入力するほど見積精度が上がります。</strong>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
            <div class="rounded-lg border p-3">
              <h4 class="font-bold text-gray-700 mb-2"><i class="fas fa-home text-hm-500 mr-1"></i>基本情報</h4>
              <ul class="space-y-1 text-gray-500"><li>案件名 / 顧客名 / ラインナップ</li><li>ステータス / 断熱等級 / 防火区分</li><li>屋根形状 / WB工法 / 平屋 / 二世帯</li></ul>
            </div>
            <div class="rounded-lg border p-3">
              <h4 class="font-bold text-gray-700 mb-2"><i class="fas fa-ruler-combined text-blue-500 mr-1"></i>面積・寸法</h4>
              <ul class="space-y-1 text-gray-500"><li>坪数 / 建築面積 / 延床面積</li><li>1F面積 / 2F面積 / 屋根面積</li><li>外壁面積 / 基礎周長 / ポーチ面積</li></ul>
            </div>
            <div class="rounded-lg border p-3">
              <h4 class="font-bold text-gray-700 mb-2"><i class="fas fa-solar-panel text-yellow-500 mr-1"></i>太陽光・オプション</h4>
              <ul class="space-y-1 text-gray-500"><li>太陽光パネル有無 / PV容量(kW)</li><li>蓄電池有無 / 蓄電池容量(kWh)</li><li>ドーマー / ロフト / 焼杉</li></ul>
            </div>
            <div class="rounded-lg border p-3">
              <h4 class="font-bold text-gray-700 mb-2"><i class="fas fa-map-marker-alt text-red-500 mr-1"></i>所在地・設備</h4>
              <ul class="space-y-1 text-gray-500"><li>都道府県 / 市区町村 / 住所</li><li>上水道引込 / 下水道引込</li><li>配管距離 / 雨樋延長</li></ul>
            </div>
          </div>
          <div class="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs">
            <i class="fas fa-info-circle text-blue-500 mr-1"></i>各項目は入力して別のフィールドに移動すると<strong>自動保存</strong>されます。「保存」ボタンを押す必要はありません。
          </div>
        </div>
      </section>

      <!-- STEP 3 -->
      <section id="step3" class="bg-white rounded-xl border p-6 mb-5">
        <h2 class="text-lg font-bold text-gray-800 mb-3 flex items-center"><span class="bg-hm-600 text-white w-8 h-8 rounded-full flex items-center justify-center text-sm mr-3 flex-shrink-0">3</span>初期計算を実行する</h2>
        <div class="space-y-3 text-sm text-gray-600">
          <div class="flex items-start gap-3 bg-green-50 rounded-lg p-4 border border-green-200">
            <div class="text-3xl text-green-600"><i class="fas fa-hand-pointer"></i></div>
            <div>
              <p class="font-bold text-green-800 text-base mb-1">ページ上部の緑の「<i class="fas fa-calculator mr-1"></i>初期計算」ボタンをクリック</p>
              <p class="text-green-700">マスタデータ（58工種・47ルール）から全工種の原価が一括で自動算出されます。</p>
            </div>
          </div>
          <div class="bg-gray-50 rounded-lg p-4">
            <h4 class="font-bold text-gray-700 text-sm mb-2">計算される工種の例：</h4>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              <div class="bg-white rounded p-2 text-center border"><strong>基礎工事</strong><br><span class="text-gray-400">坪数x単価</span></div>
              <div class="bg-white rounded p-2 text-center border"><strong>上棟費</strong><br><span class="text-gray-400">面積ベース</span></div>
              <div class="bg-white rounded p-2 text-center border"><strong>外壁工事</strong><br><span class="text-gray-400">外壁面積x単価</span></div>
              <div class="bg-white rounded p-2 text-center border"><strong>電気工事</strong><br><span class="text-gray-400">坪数ベース</span></div>
              <div class="bg-white rounded p-2 text-center border"><strong>屋根工事</strong><br><span class="text-gray-400">屋根面積x単価</span></div>
              <div class="bg-white rounded p-2 text-center border"><strong>給排水</strong><br><span class="text-gray-400">配管距離ベース</span></div>
              <div class="bg-white rounded p-2 text-center border"><strong>太陽光</strong><br><span class="text-gray-400">kWx単価</span></div>
              <div class="bg-white rounded p-2 text-center border"><strong>...他51工種</strong><br><span class="text-gray-400">全58工種</span></div>
            </div>
          </div>
          <p class="text-xs text-gray-400"><i class="fas fa-clock mr-1"></i>計算は数秒で完了し、各タブにデータが表示されます。</p>
        </div>
      </section>

      <!-- STEP 4: INDIVIDUAL COST ITEM EDITING (KEY SECTION) -->
      <section id="step4" class="bg-white rounded-xl border-2 border-hm-400 p-6 mb-5">
        <h2 class="text-lg font-bold text-gray-800 mb-1 flex items-center"><span class="bg-hm-600 text-white w-8 h-8 rounded-full flex items-center justify-center text-sm mr-3 flex-shrink-0">4</span>個別の工種見積を修正する（「工種明細」タブ）</h2>
        <p class="text-xs text-hm-600 font-medium mb-4 ml-11">-- 元シートの「工種別タブ」に相当する機能です --</p>
        <div class="space-y-4 text-sm text-gray-600">
          <div class="bg-hm-50 border border-hm-200 rounded-lg p-4">
            <h3 class="font-bold text-hm-800 mb-2"><i class="fas fa-star mr-1"></i>元シートとの対応</h3>
            <p>元のシートでは「基礎工事」「上棟費」「外壁」...と<strong>各工種ごとに別タブ</strong>で見積入力していました。</p>
            <p class="mt-1">本システムでは、全58工種が<strong>「工種明細」タブの一覧表</strong>にまとめて表示されます。各行の<strong>鉛筆アイコン <i class="fas fa-pen-to-square text-hm-600"></i></strong> をクリックすると、その工種の<strong>数量・単価・金額を個別に修正</strong>できます。</p>
          </div>

          <h3 class="font-bold text-gray-700"><i class="fas fa-search mr-1"></i>一覧画面の見方</h3>
          <div class="overflow-x-auto">
            <table class="w-full text-xs border rounded-lg overflow-hidden">
              <thead class="bg-gray-100"><tr>
                <th class="px-3 py-2 text-left font-bold">カテゴリ</th><th class="px-3 py-2 text-left font-bold">工種名</th>
                <th class="px-3 py-2 text-right font-bold">数量</th><th class="px-3 py-2 text-right font-bold">自動金額</th>
                <th class="px-3 py-2 text-right font-bold">最終金額</th><th class="px-3 py-2 text-center font-bold">状態</th>
                <th class="px-3 py-2 text-center font-bold">操作</th>
              </tr></thead>
              <tbody>
                <tr class="bg-white border-t"><td class="px-3 py-2 text-gray-400">FND</td><td class="px-3 py-2 font-medium">基礎工事</td><td class="px-3 py-2 text-right">117.33 m2</td><td class="px-3 py-2 text-right text-gray-500">&#165;950,000</td><td class="px-3 py-2 text-right font-bold">&#165;950,000</td><td class="px-3 py-2 text-center"><span class="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">未確認</span></td><td class="px-3 py-2 text-center text-hm-600"><i class="fas fa-pen-to-square"></i> <span class="text-gray-400">&larr;ここ</span></td></tr>
                <tr class="bg-orange-50 border-t"><td class="px-3 py-2 text-gray-400">STR</td><td class="px-3 py-2 font-medium">上棟費</td><td class="px-3 py-2 text-right">1 式</td><td class="px-3 py-2 text-right text-gray-500">&#165;200,000</td><td class="px-3 py-2 text-right font-bold text-orange-600">&#165;250,000</td><td class="px-3 py-2 text-center"><span class="bg-green-100 text-green-700 px-2 py-0.5 rounded-full">確認済</span></td><td class="px-3 py-2 text-center text-hm-600"><i class="fas fa-pen-to-square"></i></td></tr>
              </tbody>
            </table>
            <p class="text-xs text-gray-400 mt-1"><i class="fas fa-info-circle mr-1"></i>オレンジ色の金額 = 手動修正済み / 黒字 = 自動算出のまま</p>
          </div>

          <h3 class="font-bold text-gray-700 mt-4"><i class="fas fa-pen-to-square mr-1 text-hm-600"></i>個別の工種を修正する手順</h3>
          <div class="space-y-3">
            <div class="flex items-start gap-3 bg-gray-50 rounded-lg p-3">
              <span class="bg-hm-600 text-white min-w-[28px] h-7 flex items-center justify-center rounded-lg text-xs font-bold flex-shrink-0">1</span>
              <div>修正したい工種の行の <strong><i class="fas fa-pen-to-square text-hm-600"></i> アイコン</strong>（または行そのもの）をクリック → <strong>編集ダイアログ</strong>が開きます</div>
            </div>
            <div class="flex items-start gap-3 bg-gray-50 rounded-lg p-3">
              <span class="bg-hm-600 text-white min-w-[28px] h-7 flex items-center justify-center rounded-lg text-xs font-bold flex-shrink-0">2</span>
              <div>以下の項目を必要に応じて変更：
                <div class="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2 text-xs">
                  <div class="bg-white border rounded p-2"><strong>手修正 数量</strong><br><span class="text-gray-400">例: 外壁面積を実測値に変更</span></div>
                  <div class="bg-white border rounded p-2"><strong>手修正 単価</strong><br><span class="text-gray-400">例: 業者見積の単価に変更</span></div>
                  <div class="bg-white border rounded p-2"><strong>手修正 金額</strong><br><span class="text-gray-400">例: 一式の金額を直接入力</span></div>
                  <div class="bg-white border rounded p-2"><strong>変更理由</strong><br><span class="text-gray-400">「業者見積による」「仕様変更」等</span></div>
                </div>
              </div>
            </div>
            <div class="flex items-start gap-3 bg-gray-50 rounded-lg p-3">
              <span class="bg-hm-600 text-white min-w-[28px] h-7 flex items-center justify-center rounded-lg text-xs font-bold flex-shrink-0">3</span>
              <div>「<strong>保存</strong>」ボタンをクリック → 最終金額が更新され、原価サマリにも即時反映されます</div>
            </div>
          </div>

          <div class="bg-green-50 border border-green-200 rounded-lg p-4 mt-2">
            <h4 class="font-bold text-green-800 text-sm mb-2"><i class="fas fa-filter mr-1"></i>便利機能</h4>
            <ul class="space-y-1 text-xs text-green-700">
              <li><i class="fas fa-check mr-1"></i><strong>検索</strong>：工種名で絞り込み（例: 「基礎」「電気」「外壁」）</li>
              <li><i class="fas fa-check mr-1"></i><strong>ステータスフィルタ</strong>：「未確認」「確認済」「要確認」で絞り込み</li>
              <li><i class="fas fa-check mr-1"></i><strong>レビュー</strong>：確認した工種を「確認済」にマークして進捗管理</li>
            </ul>
          </div>

          <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h4 class="font-bold text-blue-800 text-sm mb-2"><i class="fas fa-question-circle mr-1"></i>「元シートのように1工種ずつ見積もりたい」場合</h4>
            <ol class="list-decimal list-inside text-xs text-blue-700 mt-2 space-y-1">
              <li>「工種明細」タブを開く</li>
              <li>上部の検索ボックスに工種名を入力（例: 「基礎」）</li>
              <li>絞り込まれた工種の <i class="fas fa-pen-to-square text-hm-600"></i> をクリック</li>
              <li>数量・単価・金額を入力して「保存」</li>
              <li>次の工種を検索して同じ操作を繰り返す</li>
            </ol>
            <p class="text-xs text-blue-600 mt-2 font-medium">これで元シートの「タブ切替 → 入力」と同じ操作が1つの画面でできます。</p>
          </div>
        </div>
      </section>

      <!-- STEP 5 -->
      <section id="step5" class="bg-white rounded-xl border p-6 mb-5">
        <h2 class="text-lg font-bold text-gray-800 mb-3 flex items-center"><span class="bg-hm-600 text-white w-8 h-8 rounded-full flex items-center justify-center text-sm mr-3 flex-shrink-0">5</span>原価サマリを確認する（「原価サマリ」タブ）</h2>
        <div class="text-sm text-gray-600 space-y-3">
          <p>「<strong>原価サマリ</strong>」タブで、カテゴリ別の原価合計と構成比を確認できます。</p>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div class="bg-gray-50 rounded-lg p-3 text-center border"><strong>原価合計</strong><br><span class="text-gray-400">全工種の合算額</span></div>
            <div class="bg-gray-50 rounded-lg p-3 text-center border"><strong>標準原価</strong><br><span class="text-gray-400">基本工事の原価</span></div>
            <div class="bg-gray-50 rounded-lg p-3 text-center border"><strong>太陽光原価</strong><br><span class="text-gray-400">太陽光関連の原価</span></div>
            <div class="bg-gray-50 rounded-lg p-3 text-center border"><strong>オプション原価</strong><br><span class="text-gray-400">追加工事の原価</span></div>
          </div>
        </div>
      </section>

      <!-- STEP 6 -->
      <section id="step6" class="bg-white rounded-xl border-2 border-yellow-300 p-6 mb-5">
        <h2 class="text-lg font-bold text-gray-800 mb-3 flex items-center"><span class="bg-hm-600 text-white w-8 h-8 rounded-full flex items-center justify-center text-sm mr-3 flex-shrink-0">6</span>売価見積もりとは（「売価見積」タブ）</h2>
        <div class="text-sm text-gray-600 space-y-3">
          <div class="bg-yellow-50 border border-yellow-300 rounded-lg p-4">
            <h3 class="font-bold text-yellow-800 mb-2"><i class="fas fa-question-circle mr-1"></i>「売価」とは何か？</h3>
            <p><strong>売価 = お客様に提示する販売価格（税抜）</strong>です。原価（工事にかかるコスト）に対して、会社の利益（粗利）を上乗せした金額です。</p>
            <div class="grid grid-cols-3 gap-3 mt-3 text-center text-xs">
              <div class="bg-white rounded-lg p-3 border"><i class="fas fa-hard-hat text-blue-500 text-xl mb-1"></i><br><strong>原価</strong><br>工事に実際にかかる費用<br><span class="text-gray-400">（自動計算済み）</span></div>
              <div class="bg-white rounded-lg p-3 border"><i class="fas fa-plus text-gray-400 text-xl mb-1"></i><br><strong>粗利</strong><br>会社の利益分<br><span class="text-gray-400">（目標: 原価の30%）</span></div>
              <div class="bg-white rounded-lg p-3 border border-yellow-400"><i class="fas fa-yen-sign text-yellow-600 text-xl mb-1"></i><br><strong>売価</strong><br>お客様提示価格<br><span class="text-yellow-600 font-bold">これを入力</span></div>
            </div>
            <p class="text-xs text-yellow-700 mt-3"><i class="fas fa-lightbulb mr-1"></i><strong>例</strong>: 原価 2,000万円、目標粗利率30% → 目標売価 = 2,000万 / (1-0.3) ≒ 2,857万円</p>
          </div>
          <div class="space-y-3">
            <div class="flex items-start gap-3 bg-gray-50 rounded-lg p-3"><span class="bg-hm-600 text-white min-w-[28px] h-7 flex items-center justify-center rounded-lg text-xs font-bold flex-shrink-0">1</span><div>種別を選択（概算 / 社内 / 契約 / 実行）— 見積フェーズに対応</div></div>
            <div class="flex items-start gap-3 bg-gray-50 rounded-lg p-3"><span class="bg-hm-600 text-white min-w-[28px] h-7 flex items-center justify-center rounded-lg text-xs font-bold flex-shrink-0">2</span><div>「売価合計」に<strong>お客様に提示する金額</strong>を入力。標準売価・太陽光売価の内訳も入力可能</div></div>
            <div class="flex items-start gap-3 bg-gray-50 rounded-lg p-3"><span class="bg-hm-600 text-white min-w-[28px] h-7 flex items-center justify-center rounded-lg text-xs font-bold flex-shrink-0">3</span><div>「<strong>登録</strong>」→ 自動で<strong>粗利率</strong>・<strong>乖離分析</strong>（原価との差）を表示。OK/注意/NGを判定</div></div>
          </div>
          <div class="grid grid-cols-3 gap-3 text-xs">
            <div class="bg-green-50 border border-green-200 rounded-lg p-3 text-center"><span class="text-green-600 font-bold text-lg">OK</span><br>粗利率が目標範囲内</div>
            <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-center"><span class="text-yellow-600 font-bold text-lg">注意</span><br>粗利率が目標を10%以上下回る</div>
            <div class="bg-red-50 border border-red-200 rounded-lg p-3 text-center"><span class="text-red-600 font-bold text-lg">NG</span><br>粗利率が目標を20%以上下回る or 赤字</div>
          </div>
        </div>
      </section>

      <!-- STEP 7 -->
      <section id="step7" class="bg-white rounded-xl border p-6 mb-5">
        <h2 class="text-lg font-bold text-gray-800 mb-3 flex items-center"><span class="bg-hm-600 text-white w-8 h-8 rounded-full flex items-center justify-center text-sm mr-3 flex-shrink-0">7</span>リスクセンターで全体確認</h2>
        <div class="text-sm text-gray-600 space-y-3">
          <p>「<strong>リスクセンター</strong>」タブは案件全体の健全度をダッシュボード形式で表示します。</p>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div class="rounded-lg p-3 border-l-4 border-red-400 bg-gray-50"><strong class="text-xs text-gray-700">リスクレベル</strong><p class="text-xs text-gray-500 mt-1">LOW / MEDIUM / HIGH / CRITICAL</p></div>
            <div class="rounded-lg p-3 border-l-4 border-blue-400 bg-gray-50"><strong class="text-xs text-gray-700">入力完了率</strong><p class="text-xs text-gray-500 mt-1">必須項目の入力率（%）</p></div>
            <div class="rounded-lg p-3 border-l-4 border-green-400 bg-gray-50"><strong class="text-xs text-gray-700">レビュー進捗</strong><p class="text-xs text-gray-500 mt-1">確認済み / 全工種数</p></div>
            <div class="rounded-lg p-3 border-l-4 border-yellow-400 bg-gray-50"><strong class="text-xs text-gray-700">粗利率</strong><p class="text-xs text-gray-500 mt-1">現在のマージン</p></div>
          </div>
        </div>
      </section>

      <!-- STEP 8 -->
      <section id="step8" class="bg-white rounded-xl border p-6 mb-5">
        <h2 class="text-lg font-bold text-gray-800 mb-3 flex items-center"><span class="bg-hm-600 text-white w-8 h-8 rounded-full flex items-center justify-center text-sm mr-3 flex-shrink-0">8</span>仕様変更時の再計算と差分解決</h2>
        <div class="text-sm text-gray-600 space-y-3">
          <p>建物の仕様を変更した場合、ページ上部の青い「<strong class="text-blue-600"><i class="fas fa-sync-alt mr-1"></i>再計算</strong>」ボタンで原価を更新できます。</p>
          <div class="bg-gray-50 rounded-lg p-4">
            <strong class="text-sm">3つの再計算モード：</strong>
            <div class="mt-2 space-y-2 text-xs">
              <div class="flex items-start gap-2"><span class="bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-bold">推奨</span><div><strong>レビュー済保持</strong>：確認済の工種はそのまま、未確認だけ再計算。</div></div>
              <div class="flex items-start gap-2"><span class="bg-gray-200 text-gray-600 px-2 py-0.5 rounded font-bold">中間</span><div><strong>自動項目のみ</strong>：手動修正した工種は保持。自動算出のみ再計算。</div></div>
              <div class="flex items-start gap-2"><span class="bg-red-100 text-red-600 px-2 py-0.5 rounded font-bold">注意</span><div><strong>全置換</strong>：全工種を最新ルールで再計算（手動修正も上書き）。</div></div>
            </div>
          </div>
          <p>再計算後、「<strong>差分解決</strong>」タブで変更内容を確認し、「新値採用」「旧値維持」「手動調整」を選択してください。</p>
        </div>
      </section>

      <!-- STATUS TRANSITIONS -->
      <section id="statuses" class="bg-white rounded-xl border-2 border-purple-300 p-6 mb-5">
        <h2 class="text-lg font-bold text-gray-800 mb-3 flex items-center"><span class="bg-purple-600 text-white w-8 h-8 rounded-full flex items-center justify-center text-sm mr-3 flex-shrink-0">9</span>ステータスの意味と遷移</h2>
        <div class="text-sm text-gray-600 space-y-4">
          <p>案件一覧の各カードに表示されるステータスは、案件の進行状況を示します。</p>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div class="bg-gray-50 rounded-lg p-4 border-l-4 border-gray-400"><strong class="text-gray-700 text-sm">下書き (draft)</strong><br>案件を作成した直後の状態。建物情報を入力中。初期計算がまだ実行されていない。<br><span class="text-gray-400">→ 建物情報を入力して「初期計算」を実行すると次へ</span></div>
            <div class="bg-blue-50 rounded-lg p-4 border-l-4 border-blue-500"><strong class="text-blue-700 text-sm">進行中 (in_progress)</strong><br>初期計算が完了し、工種明細の確認・修正作業中。業者見積の反映や個別修正を行う段階。<br><span class="text-gray-400">→ 修正完了後、「案件情報」タブでステータスを変更</span></div>
            <div class="bg-yellow-50 rounded-lg p-4 border-l-4 border-yellow-500"><strong class="text-yellow-700 text-sm">要レビュー (needs_review)</strong><br>見積担当者が作業完了し、管理者のレビュー待ち。未解決の差分やフラグ項目があればここに留まる。<br><span class="text-gray-400">→ 管理者がレビュー後、「レビュー済」に変更</span></div>
            <div class="bg-green-50 rounded-lg p-4 border-l-4 border-green-500"><strong class="text-green-700 text-sm">レビュー済 (reviewed)</strong><br>管理者のレビューが完了した状態。売価見積の登録・粗利確認が可能。お客様への提示準備完了。<br><span class="text-gray-400">→ 必要に応じてアーカイブ</span></div>
          </div>
          <div class="bg-purple-50 border border-purple-200 rounded-lg p-3 text-xs">
            <i class="fas fa-arrows-alt-h text-purple-500 mr-1"></i><strong>ステータスの変更方法</strong>: 案件詳細の「<strong>案件情報</strong>」タブで、基本情報セクションの「ステータス」ドロップダウンから変更できます。変更は即座に保存されます。
          </div>
          <div class="bg-gray-50 rounded-lg p-4">
            <h4 class="font-bold text-gray-700 text-sm mb-2">推奨フロー</h4>
            <div class="flex items-center gap-2 text-xs flex-wrap">
              <span class="bg-gray-200 text-gray-700 px-3 py-1.5 rounded-full font-medium">下書き</span>
              <i class="fas fa-arrow-right text-gray-300"></i>
              <span class="text-gray-400">初期計算</span>
              <i class="fas fa-arrow-right text-gray-300"></i>
              <span class="bg-blue-200 text-blue-700 px-3 py-1.5 rounded-full font-medium">進行中</span>
              <i class="fas fa-arrow-right text-gray-300"></i>
              <span class="text-gray-400">修正完了</span>
              <i class="fas fa-arrow-right text-gray-300"></i>
              <span class="bg-yellow-200 text-yellow-700 px-3 py-1.5 rounded-full font-medium">要レビュー</span>
              <i class="fas fa-arrow-right text-gray-300"></i>
              <span class="text-gray-400">管理者確認</span>
              <i class="fas fa-arrow-right text-gray-300"></i>
              <span class="bg-green-200 text-green-700 px-3 py-1.5 rounded-full font-medium">レビュー済</span>
            </div>
          </div>
        </div>
      </section>

      <!-- EACH TAB DETAILED GUIDE -->
      <section id="tabs" class="bg-white rounded-xl border p-6 mb-5">
        <h2 class="text-lg font-bold text-gray-800 mb-3 flex items-center"><span class="bg-hm-600 text-white w-8 h-8 rounded-full flex items-center justify-center text-sm mr-3 flex-shrink-0">10</span>各タブの詳細ガイド</h2>
        <div class="space-y-4 text-sm text-gray-600">
          <div class="bg-red-50 border border-red-200 rounded-lg p-4">
            <h3 class="font-bold text-red-800 mb-2"><i class="fas fa-shield-alt mr-1"></i>リスクセンター</h3>
            <p>案件全体の「健康診断」ダッシュボード。リスクレベル（LOW〜CRITICAL）、入力完了率、レビュー進捗、粗利率を一目で把握。<strong>赤い「要対応」</strong>項目から優先的に対処してください。</p>
          </div>
          <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h3 class="font-bold text-blue-800 mb-2"><i class="fas fa-edit mr-1"></i>案件情報</h3>
            <p>建物の基本情報・面積・仕様・所在地・太陽光・設備オプション・粗利率設定を入力するタブ。<strong>各項目は変更即保存</strong>（自動保存）。ここの入力が原価自動計算の精度を左右します。</p>
            <p class="text-xs text-blue-600 mt-1">セクション: 基本情報 / 面積・寸法 / 所在地 / 太陽光・オプション / 設備・インフラ / 粗利率設定</p>
          </div>
          <div class="bg-green-50 border border-green-200 rounded-lg p-4">
            <h3 class="font-bold text-green-800 mb-2"><i class="fas fa-list-alt mr-1"></i>工種明細</h3>
            <p>58工種の一覧。検索・フィルタで絞り込み、鉛筆アイコンで個別に数量・単価・金額を修正。元シートの「工種別タブ」に相当。<a href="#step4" class="text-green-600 underline">STEP 4を参照</a></p>
          </div>
          <div class="bg-orange-50 border border-orange-200 rounded-lg p-4">
            <h3 class="font-bold text-orange-800 mb-2"><i class="fas fa-code-compare mr-1"></i>差分解決</h3>
            <p><strong>仕様変更後の「再計算」で発生した差分</strong>を確認・処理するタブ。</p>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2 text-xs">
              <div class="bg-white rounded p-2 border"><strong class="text-blue-700">新値採用</strong><br>再計算の新しい値を採用</div>
              <div class="bg-white rounded p-2 border"><strong class="text-gray-700">旧値維持</strong><br>元の値をそのまま使う</div>
              <div class="bg-white rounded p-2 border"><strong class="text-yellow-700">却下</strong><br>差分を無視</div>
              <div class="bg-white rounded p-2 border"><strong class="text-orange-700">手動調整</strong><br>自分で金額を入力</div>
            </div>
            <p class="text-xs text-orange-600 mt-2"><i class="fas fa-lightbulb mr-1"></i>赤い「重要」バッジが付いた差分は大きな金額変動を含むため、優先的に確認してください。</p>
          </div>
          <div class="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
            <h3 class="font-bold text-indigo-800 mb-2"><i class="fas fa-chart-pie mr-1"></i>原価サマリ</h3>
            <p><strong>全工種の原価合計をカテゴリ別に集計</strong>した表。「自動合計」「手動調整」「最終合計」と各カテゴリの構成比（%）を確認できます。原価全体の内訳を把握するのに使います。</p>
            <p class="text-xs text-indigo-600 mt-1">上部のカードで原価合計・標準原価・太陽光原価・オプション原価の4つを一目で確認。</p>
          </div>
          <div class="bg-purple-50 border border-purple-200 rounded-lg p-4">
            <h3 class="font-bold text-purple-800 mb-2"><i class="fas fa-robot mr-1"></i>AI・警告</h3>
            <p>AI条件チェック結果と、システムが検出した各種警告の管理画面。未読の警告はここで「既読」「解決」「無視」に変更。帳票テキスト読取（PDF文字起こし結果の反映）もここで実行。</p>
          </div>
        </div>
      </section>

      <!-- MASTER ITEM MANAGEMENT -->
      <section id="master" class="bg-white rounded-xl border-2 border-hm-400 p-6 mb-5">
        <h2 class="text-lg font-bold text-gray-800 mb-3 flex items-center"><span class="bg-hm-600 text-white w-8 h-8 rounded-full flex items-center justify-center text-sm mr-3 flex-shrink-0">11</span>単価マスタの変更方法</h2>
        <div class="text-sm text-gray-600 space-y-3">
          <p>基礎工事・上棟費・太陽光などの<strong>デフォルト単価</strong>は「<a href="/ui/admin" class="text-hm-600 underline">管理画面</a>」→「<strong>単価マスタ</strong>」タブで変更できます。</p>
          <div class="space-y-2">
            <div class="flex items-start gap-3 bg-gray-50 rounded-lg p-3">
              <span class="bg-hm-600 text-white min-w-[28px] h-7 flex items-center justify-center rounded-lg text-xs font-bold flex-shrink-0">1</span>
              <div>ナビバーの「<strong>管理</strong>」をクリック → 「<strong>単価マスタ</strong>」タブを選択</div></div>
            <div class="flex items-start gap-3 bg-gray-50 rounded-lg p-3">
              <span class="bg-hm-600 text-white min-w-[28px] h-7 flex items-center justify-center rounded-lg text-xs font-bold flex-shrink-0">2</span>
              <div>カテゴリ選択や検索ボックスで変更したい工種を絞り込み</div></div>
            <div class="flex items-start gap-3 bg-gray-50 rounded-lg p-3">
              <span class="bg-hm-600 text-white min-w-[28px] h-7 flex items-center justify-center rounded-lg text-xs font-bold flex-shrink-0">3</span>
              <div>鉛筆アイコンをクリック → 「デフォルト単価」「固定額」を変更して「保存」</div></div>
          </div>
          <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-xs">
            <i class="fas fa-exclamation-triangle text-yellow-600 mr-1"></i><strong>注意</strong>：単価の変更は<strong>既存の案件には影響しません</strong>。既存案件に反映するには、案件の「再計算」を実行してください。新規案件は変更後の単価で自動計算されます。
          </div>
          <div class="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs">
            <i class="fas fa-lock text-blue-500 mr-1"></i><strong>権限</strong>：単価マスタの変更は<strong>admin権限</strong>のユーザーのみ可能です。
          </div>
        </div>
      </section>

      <!-- FAQ -->
      <section id="faq" class="bg-white rounded-xl border p-6 mb-5">
        <h2 class="text-lg font-bold text-gray-800 mb-4 flex items-center"><span class="bg-hm-600 text-white w-8 h-8 rounded-full flex items-center justify-center text-sm mr-3 flex-shrink-0">12</span>よくある質問（FAQ）</h2>
        <div class="space-y-4 text-sm">
          <div class="border-b pb-3"><h3 class="font-bold text-gray-800"><i class="fas fa-question-circle text-hm-500 mr-1"></i>Q. 元シートのように各工種を1つずつ見積もりたい</h3><p class="text-gray-600 mt-1"><strong>A.</strong> 「工種明細」タブで検索ボックスに工種名を入力 → 編集アイコンをクリック → 数量・単価・金額を変更。<a href="#step4" class="text-hm-600 underline">詳しくはSTEP 4</a></p></div>
          <div class="border-b pb-3"><h3 class="font-bold text-gray-800"><i class="fas fa-question-circle text-hm-500 mr-1"></i>Q. 業者からの見積書を反映したい</h3><p class="text-gray-600 mt-1"><strong>A.</strong> 「工種明細」で該当工種を開き、「手修正 金額」に業者見積額を入力。変更理由で「業者見積」を選択して保存。</p></div>
          <div class="border-b pb-3"><h3 class="font-bold text-gray-800"><i class="fas fa-question-circle text-hm-500 mr-1"></i>Q. 自動計算された金額が実際と違う</h3><p class="text-gray-600 mt-1"><strong>A.</strong> まず「案件情報」タブで建物情報（坪数・面積等）が正しいか確認。正しい場合は工種明細で手動修正できます。</p></div>
          <div class="border-b pb-3"><h3 class="font-bold text-gray-800"><i class="fas fa-question-circle text-hm-500 mr-1"></i>Q. 仕様を変更したら原価はどうなる？</h3><p class="text-gray-600 mt-1"><strong>A.</strong> 「案件情報」で仕様を変更 → 「再計算」ボタン → 変更差分が「差分解決」タブに表示。手動修正した工種は保持されます。</p></div>
          <div class="border-b pb-3"><h3 class="font-bold text-gray-800"><i class="fas fa-question-circle text-hm-500 mr-1"></i>Q. 「初期計算」ボタンが見当たらない</h3><p class="text-gray-600 mt-1"><strong>A.</strong> 計算実行後は「再計算」ボタンに変わります。案件詳細ページの上部ヘッダー右側にあります。</p></div>
          <div class="border-b pb-3"><h3 class="font-bold text-gray-800"><i class="fas fa-question-circle text-hm-500 mr-1"></i>Q. 粗利率の目標値を変えたい</h3><p class="text-gray-600 mt-1"><strong>A.</strong> 「案件情報」タブの下部「粗利率設定」セクションで案件ごとの目標粗利率を設定できます。</p></div>
          <div class="border-b pb-3"><h3 class="font-bold text-gray-800"><i class="fas fa-question-circle text-hm-500 mr-1"></i>Q. 「売価」って何？原価の販売価格のこと？</h3><p class="text-gray-600 mt-1"><strong>A.</strong> 売価 = お客様に提示する建物全体の価格です。原価（工事コスト）+ 粗利（会社利益）= 売価。原価とは別物です。<a href="#step6" class="text-hm-600 underline">詳しくはSTEP 6</a></p></div>
          <div class="border-b pb-3"><h3 class="font-bold text-gray-800"><i class="fas fa-question-circle text-hm-500 mr-1"></i>Q. 単価のデフォルト値を変えたい</h3><p class="text-gray-600 mt-1"><strong>A.</strong> ナビの「管理」→「単価マスタ」タブで変更可能です（admin権限が必要）。<a href="#master" class="text-hm-600 underline">詳しくはセクション11</a></p></div>
          <div class="border-b pb-3"><h3 class="font-bold text-gray-800"><i class="fas fa-question-circle text-hm-500 mr-1"></i>Q. 案件のステータスがよくわからない</h3><p class="text-gray-600 mt-1"><strong>A.</strong> 下書き→進行中→要レビュー→レビュー済の順に進みます。「案件情報」タブで手動変更可能。<a href="#statuses" class="text-hm-600 underline">詳しくはセクション9</a></p></div>
          <div class="border-b pb-3"><h3 class="font-bold text-gray-800"><i class="fas fa-question-circle text-hm-500 mr-1"></i>Q. 「差分解決」って何？</h3><p class="text-gray-600 mt-1"><strong>A.</strong> 仕様変更後の「再計算」で生じた金額変動のこと。新値を採用するか、旧値を維持するか選べます。<a href="#tabs" class="text-hm-600 underline">詳しくはセクション10</a></p></div>
          <div><h3 class="font-bold text-gray-800"><i class="fas fa-question-circle text-hm-500 mr-1"></i>Q. 他の人の案件が見えない</h3><p class="text-gray-600 mt-1"><strong>A.</strong> estimator権限のユーザーは自分が作成した案件のみ表示されます。全案件を見るにはmanager以上の権限が必要です。管理者にお問い合わせください。</p></div>
        </div>
      </section>

      <!-- Terms -->
      <section id="terms" class="bg-white rounded-xl border p-6 mb-8">
        <h2 class="text-lg font-bold text-gray-800 mb-3 flex items-center"><span class="bg-hm-600 text-white w-8 h-8 rounded-full flex items-center justify-center text-sm mr-3 flex-shrink-0">13</span>用語集</h2>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div class="bg-gray-50 rounded-lg p-3"><strong>スナップショット</strong><br><span class="text-gray-500">ある時点の原価計算結果のコピー。再計算のたびに新しいスナップショットが作られます。</span></div>
          <div class="bg-gray-50 rounded-lg p-3"><strong>工種</strong><br><span class="text-gray-500">建築の各作業区分（基礎工事、上棟費等）。現在58工種がマスタ登録済み。</span></div>
          <div class="bg-gray-50 rounded-lg p-3"><strong>マージン（粗利率）</strong><br><span class="text-gray-500">(売価-原価)/売価x100。30%が標準目標値。</span></div>
          <div class="bg-gray-50 rounded-lg p-3"><strong>ギャップ（乖離）</strong><br><span class="text-gray-500">期待粗利率と実際の粗利率の差。正値=マージン不足。</span></div>
          <div class="bg-gray-50 rounded-lg p-3"><strong>ラインナップ</strong><br><span class="text-gray-500">平松建築の商品シリーズ。SHIN / RIN / MOKU（大屋根・平屋・ROKU）の5種類。</span></div>
          <div class="bg-gray-50 rounded-lg p-3"><strong>リスクスコア</strong><br><span class="text-gray-500">案件の問題度。エラーx10、警告x3、情報x1で加算。</span></div>
          <div class="bg-gray-50 rounded-lg p-3"><strong>売価</strong><br><span class="text-gray-500">お客様に提示する販売価格（税抜）。原価+粗利=売価。</span></div>
          <div class="bg-gray-50 rounded-lg p-3"><strong>原価サマリ</strong><br><span class="text-gray-500">全工種の原価合計をカテゴリ別に集計した一覧。</span></div>
          <div class="bg-gray-50 rounded-lg p-3"><strong>差分解決</strong><br><span class="text-gray-500">再計算で生じた金額変動を確認し、採用/維持/調整を選ぶ作業。</span></div>
        </div>
      </section>

      <!-- Quick Links -->
      <div class="bg-gradient-to-r from-hm-50 to-hm-100 rounded-xl border border-hm-200 p-5 text-center">
        <p class="text-sm text-hm-800 mb-3"><strong>さっそく使ってみましょう！</strong></p>
        <div class="flex justify-center gap-3 flex-wrap">
          <a href="/ui/projects" class="inline-block bg-hm-600 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-hm-700 transition shadow-sm"><i class="fas fa-rocket mr-1"></i>案件一覧へ</a>
          <a href="/api/health" target="_blank" class="inline-block bg-white text-hm-600 px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-hm-50 transition border border-hm-300"><i class="fas fa-heartbeat mr-1"></i>システム状態</a>
        </div>
      </div>
    </div>
  `, 'manual'));
});

export default uiRoutes;
