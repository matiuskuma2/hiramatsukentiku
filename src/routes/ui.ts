// ==============================================
// Frontend UI Routes (Step 5 — Full Frontend Enhancement)
// SPA-style pages rendered from Hono with Alpine.js
//
// Pages:
//   /ui/projects — Project list with filters, create modal
//   /ui/projects/:id — Project detail with 6 tabs:
//     - Risk Centre (operational)
//     - Cost Items (with edit modal)
//     - Diff Resolution (adopt/keep/dismiss/manual)
//     - Cost Summary (category breakdown)
//     - Sales Estimate (CRUD + gap viz)
//     - AI Warnings (confidence/severity display)
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
    /* Toast */
    .toast-enter { animation: toastIn 0.3s ease-out; }
    @keyframes toastIn { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
    /* Skeleton */
    .skeleton { background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite; }
    @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
  </style>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            hm: { 50:'#f0fdf4', 100:'#dcfce7', 200:'#bbf7d0', 300:'#86efac', 400:'#4ade80', 500:'#22c55e', 600:'#16a34a', 700:'#15803d', 800:'#166534', 900:'#14532d' }
          }
        }
      }
    }
  </script>
</head>
<body class="bg-gray-50 min-h-screen">
  <!-- Navigation -->
  <nav class="bg-white shadow-sm border-b sticky top-0 z-50">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="flex justify-between h-14">
        <div class="flex items-center space-x-8">
          <a href="/ui/projects" class="flex items-center space-x-2">
            <i class="fas fa-building text-hm-600 text-lg"></i>
            <span class="font-bold text-gray-800 text-sm">平松建築 原価管理</span>
          </a>
          <div class="hidden md:flex space-x-1">
            <a href="/ui/projects" class="px-3 py-2 rounded-md text-sm font-medium ${activeTab === 'projects' ? 'bg-hm-50 text-hm-700' : 'text-gray-600 hover:bg-gray-100'}">
              <i class="fas fa-folder-open mr-1"></i>案件一覧
            </a>
          </div>
        </div>
        <div class="flex items-center space-x-3">
          <span class="text-xs text-gray-400">v0.5.0 Step 5</span>
          <a href="/api/health" target="_blank" class="text-xs text-gray-400 hover:text-gray-600"><i class="fas fa-heartbeat mr-1"></i>API</a>
        </div>
      </div>
    </div>
  </nav>
  
  <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
    ${bodyContent}
  </main>

  <script>
    // ── Shared API Utilities ──
    const api = {
      async get(path) { const r = await fetch('/api' + path); return r.json(); },
      async post(path, body) { const r = await fetch('/api' + path, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) }); return r.json(); },
      async patch(path, body) { const r = await fetch('/api' + path, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) }); return r.json(); },
      async del(path) { const r = await fetch('/api' + path, { method:'DELETE' }); return r.json(); },
    };
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
    };
  </script>
</body>
</html>`;
}

// ── Status Badge Colors ──
const STATUS_CLASSES: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  calculating: 'bg-indigo-100 text-indigo-700',
  in_progress: 'bg-blue-100 text-blue-700',
  needs_review: 'bg-yellow-100 text-yellow-700',
  reviewed: 'bg-green-100 text-green-700',
  archived: 'bg-purple-100 text-purple-600',
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
      <!-- Header -->
      <div class="flex justify-between items-center mb-6">
        <div>
          <h1 class="text-2xl font-bold text-gray-800"><i class="fas fa-folder-open mr-2 text-hm-600"></i>案件一覧</h1>
          <p class="text-sm text-gray-500 mt-1">見積案件の管理・作成</p>
        </div>
        <button @click="showCreate = true" class="bg-hm-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-hm-700 transition shadow-sm">
          <i class="fas fa-plus mr-1.5"></i>新規案件
        </button>
      </div>

      <!-- Status Filter Tabs -->
      <div class="flex gap-2 mb-5 flex-wrap">
        <template x-for="s in statusFilters" :key="s.value">
          <button @click="filter = s.value; load()"
            :class="filter === s.value ? 'bg-hm-600 text-white shadow-sm' : 'bg-white text-gray-600 hover:bg-gray-50 border'"
            class="px-3.5 py-1.5 rounded-full text-xs font-medium transition">
            <i :class="s.icon" class="mr-1"></i><span x-text="s.label"></span>
            <span x-show="s.count !== null" class="ml-1 opacity-70" x-text="'(' + s.count + ')'"></span>
          </button>
        </template>
      </div>

      <!-- Project Cards Grid -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <template x-for="p in projects" :key="p.id">
          <a :href="'/ui/projects/' + p.id" class="bg-white rounded-xl border hover:shadow-md transition-shadow p-5 block group">
            <div class="flex justify-between items-start mb-3">
              <div>
                <span class="font-mono text-xs text-hm-600" x-text="p.project_code"></span>
                <h3 class="font-semibold text-gray-900 mt-0.5 group-hover:text-hm-700 transition" x-text="p.project_name"></h3>
              </div>
              <span class="px-2 py-0.5 text-xs rounded-full font-medium"
                :class="statusClass(p.status)" x-text="fmt.status(p.status)"></span>
            </div>
            <div class="flex items-center gap-3 text-xs text-gray-500">
              <span x-show="p.lineup"><i class="fas fa-home mr-0.5"></i><span x-text="p.lineup"></span></span>
              <span x-show="p.tsubo"><i class="fas fa-ruler-combined mr-0.5"></i><span x-text="p.tsubo + '坪'"></span></span>
              <span x-show="p.customer_name"><i class="fas fa-user mr-0.5"></i><span x-text="p.customer_name"></span></span>
            </div>
            <div class="flex justify-between items-center mt-3 pt-3 border-t text-xs text-gray-400">
              <span>Rev <span x-text="p.revision_no || 0"></span></span>
              <span x-text="fmt.date(p.updated_at)"></span>
            </div>
          </a>
        </template>
      </div>

      <!-- Empty State -->
      <div x-show="!loading && projects.length === 0" class="bg-white rounded-xl border p-12 text-center">
        <i class="fas fa-inbox text-4xl text-gray-300 mb-3"></i>
        <p class="text-gray-500">案件がありません</p>
        <button @click="showCreate = true" class="mt-3 text-hm-600 hover:text-hm-700 text-sm font-medium">
          <i class="fas fa-plus mr-1"></i>最初の案件を作成
        </button>
      </div>

      <!-- Loading Skeleton -->
      <div x-show="loading" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <template x-for="i in 6"><div class="bg-white rounded-xl border p-5"><div class="skeleton h-4 w-20 rounded mb-2"></div><div class="skeleton h-5 w-40 rounded mb-3"></div><div class="skeleton h-3 w-32 rounded"></div></div></template>
      </div>

      <div class="mt-4 text-sm text-gray-500" x-show="meta.total > 0" x-text="meta.total + ' 件'"></div>

      <!-- Create Modal -->
      <div x-show="showCreate" x-cloak class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" @click.self="showCreate=false" x-transition:enter="transition ease-out duration-200" x-transition:enter-start="opacity-0" x-transition:enter-end="opacity-100">
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 slide-in" @click.stop>
          <h2 class="text-lg font-bold mb-5"><i class="fas fa-plus-circle mr-2 text-hm-600"></i>新規案件作成</h2>
          <div class="space-y-4">
            <div class="grid grid-cols-2 gap-3">
              <div><label class="block text-xs font-medium text-gray-500 mb-1">案件コード <span class="text-red-400">*</span></label>
                <input x-model="form.project_code" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500 focus:border-transparent" placeholder="2026-001"></div>
              <div><label class="block text-xs font-medium text-gray-500 mb-1">ラインナップ <span class="text-red-400">*</span></label>
                <select x-model="form.lineup" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500">
                  <option value="SHIN">SHIN</option><option value="RIN">RIN</option>
                  <option value="MOKU_OOYANE">MOKU 大屋根</option><option value="MOKU_HIRAYA">MOKU 平屋</option>
                  <option value="MOKU_ROKU">MOKU ROKU</option>
                </select></div>
            </div>
            <div><label class="block text-xs font-medium text-gray-500 mb-1">案件名 <span class="text-red-400">*</span></label>
              <input x-model="form.project_name" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500" placeholder="山田邸新築工事"></div>
            <div><label class="block text-xs font-medium text-gray-500 mb-1">顧客名</label>
              <input x-model="form.customer_name" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500"></div>
            <div class="grid grid-cols-3 gap-3">
              <div><label class="block text-xs font-medium text-gray-500 mb-1">坪数</label><input x-model.number="form.tsubo" type="number" step="0.1" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500"></div>
              <div><label class="block text-xs font-medium text-gray-500 mb-1">建築面積(m²)</label><input x-model.number="form.building_area_m2" type="number" step="0.01" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500"></div>
              <div><label class="block text-xs font-medium text-gray-500 mb-1">延床面積(m²)</label><input x-model.number="form.total_floor_area_m2" type="number" step="0.01" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500"></div>
            </div>
            <div class="grid grid-cols-3 gap-3">
              <div><label class="block text-xs font-medium text-gray-500 mb-1">断熱等級</label>
                <select x-model="form.insulation_grade" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500"><option value="">-</option><option value="5">5</option><option value="6">6</option></select></div>
              <div><label class="block text-xs font-medium text-gray-500 mb-1">屋根形状</label>
                <select x-model="form.roof_shape" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500"><option value="">-</option><option value="kirizuma">切妻</option><option value="yosemune">寄棟</option><option value="katanagare">片流れ</option><option value="flat">フラット</option></select></div>
              <div><label class="block text-xs font-medium text-gray-500 mb-1">防火区分</label>
                <select x-model="form.fire_zone_type" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500"><option value="standard">一般</option><option value="semi_fire">準防火</option><option value="fire">防火</option></select></div>
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
          {value:'', label:'全件', icon:'fas fa-th', count:null},
          {value:'draft', label:'下書き', icon:'fas fa-pencil-alt', count:null},
          {value:'in_progress', label:'進行中', icon:'fas fa-play-circle', count:null},
          {value:'needs_review', label:'要レビュー', icon:'fas fa-exclamation-circle', count:null},
          {value:'reviewed', label:'レビュー済', icon:'fas fa-check-circle', count:null},
        ],
        form: { project_code:'', project_name:'', lineup:'SHIN', customer_name:'', tsubo:null, building_area_m2:null, total_floor_area_m2:null, insulation_grade:'', roof_shape:'', fire_zone_type:'standard' },
        statusClass(s) {
          return {'draft':'bg-gray-100 text-gray-600','calculating':'bg-indigo-100 text-indigo-700','in_progress':'bg-blue-100 text-blue-700','needs_review':'bg-yellow-100 text-yellow-700','reviewed':'bg-green-100 text-green-700','archived':'bg-purple-100 text-purple-600'}[s] || 'bg-gray-100 text-gray-600';
        },
        async load() {
          this.loading = true;
          const q = this.filter ? '?status=' + this.filter : '';
          const res = await api.get('/projects' + q);
          if (res.success) { this.projects = res.data; this.meta = res.meta || { total: res.data?.length || 0 }; }
          this.loading = false;
        },
        async create() {
          this.creating = true; this.createError = '';
          const body = { ...this.form };
          if (!body.tsubo) delete body.tsubo;
          if (!body.building_area_m2) delete body.building_area_m2;
          if (!body.total_floor_area_m2) delete body.total_floor_area_m2;
          if (!body.insulation_grade) delete body.insulation_grade;
          if (!body.roof_shape) delete body.roof_shape;
          if (!body.customer_name) delete body.customer_name;
          const res = await api.post('/projects', body);
          this.creating = false;
          if (res.success) { this.showCreate = false; location.href = '/ui/projects/' + res.data.id; }
          else { this.createError = res.error || '作成に失敗しました'; }
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

      <!-- Loading State -->
      <div x-show="loading" class="space-y-4">
        <div class="bg-white rounded-xl border p-5"><div class="skeleton h-6 w-48 rounded mb-2"></div><div class="skeleton h-4 w-32 rounded"></div></div>
        <div class="grid grid-cols-4 gap-4"><template x-for="i in 4"><div class="bg-white rounded-xl border p-4"><div class="skeleton h-4 w-16 rounded mb-2"></div><div class="skeleton h-8 w-24 rounded"></div></div></template></div>
      </div>

      <!-- Project Header Card -->
      <div x-show="!loading && project" class="bg-white rounded-xl shadow-sm border p-5 mb-5">
        <div class="flex justify-between items-start">
          <div>
            <div class="flex items-center gap-3 mb-1.5">
              <span class="font-mono text-sm text-hm-600 bg-hm-50 px-2 py-0.5 rounded" x-text="project?.project_code"></span>
              <span class="px-2.5 py-0.5 text-xs rounded-full font-semibold"
                :class="statusClass(project?.status)" x-text="fmt.status(project?.status)"></span>
              <span class="text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded">Rev <span x-text="project?.revision_no || 0"></span></span>
            </div>
            <h1 class="text-xl font-bold text-gray-900" x-text="project?.project_name"></h1>
            <div class="flex items-center gap-3 text-sm text-gray-500 mt-1.5">
              <span x-show="project?.lineup"><i class="fas fa-home mr-1 text-gray-400"></i><span x-text="project?.lineup"></span></span>
              <span x-show="project?.tsubo"><i class="fas fa-ruler-combined mr-1 text-gray-400"></i><span x-text="project?.tsubo + '坪'"></span></span>
              <span x-show="project?.customer_name"><i class="fas fa-user mr-1 text-gray-400"></i><span x-text="project?.customer_name"></span></span>
              <span x-show="project?.insulation_grade"><i class="fas fa-thermometer-half mr-1 text-gray-400"></i>断熱等級<span x-text="project?.insulation_grade"></span></span>
            </div>
          </div>
          <div class="flex gap-2 flex-shrink-0">
            <button @click="enqueue('initial')" x-show="!project?.current_snapshot_id" class="bg-hm-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-hm-700 transition shadow-sm" :disabled="enqueueing">
              <span x-show="!enqueueing"><i class="fas fa-calculator mr-1"></i>初期計算</span>
              <span x-show="enqueueing"><i class="fas fa-spinner fa-spin mr-1"></i>計算中...</span>
            </button>
            <div x-show="project?.current_snapshot_id" class="flex gap-2">
              <button @click="showRegenModal=true" class="bg-blue-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition shadow-sm">
                <i class="fas fa-sync-alt mr-1"></i>再計算
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Tab Navigation -->
      <div x-show="!loading" class="flex border-b mb-5 bg-white rounded-t-xl overflow-x-auto">
        <template x-for="t in tabs">
          <button @click="activeTab = t.id; onTabChange(t.id)" class="px-4 py-3 text-sm font-medium border-b-2 transition whitespace-nowrap flex items-center gap-1.5"
            :class="activeTab === t.id ? 'border-hm-600 text-hm-700 bg-hm-50/50' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'">
            <i :class="t.icon"></i>
            <span x-text="t.label"></span>
            <span x-show="t.badge > 0" class="ml-1 px-1.5 py-0.5 text-xs rounded-full font-bold"
              :class="t.badgeColor || 'bg-gray-200 text-gray-600'" x-text="t.badge"></span>
          </button>
        </template>
      </div>

      <!-- ═══════════════════════════════════════ -->
      <!-- TAB 1: Risk Centre (実運用画面)          -->
      <!-- ═══════════════════════════════════════ -->
      <div x-show="activeTab === 'risk'" class="fade-in space-y-5">
        <div x-show="!risk" class="text-center py-12 text-gray-400">
          <i class="fas fa-spinner fa-spin text-2xl mb-2"></i><p>リスク情報を読み込み中...</p>
        </div>
        <div x-show="risk">
          <!-- Summary Cards -->
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
            <div class="bg-white rounded-xl border p-4" :class="'risk-' + (risk?.summary?.risk_level || 'low')">
              <div class="text-xs text-gray-500 mb-1"><i class="fas fa-shield-alt mr-1"></i>リスクレベル</div>
              <div class="text-2xl font-bold" :class="{'text-red-600':risk?.summary?.risk_level==='critical','text-orange-500':risk?.summary?.risk_level==='high','text-yellow-500':risk?.summary?.risk_level==='medium','text-green-500':risk?.summary?.risk_level==='low'}"
                x-text="(risk?.summary?.risk_level||'').toUpperCase()"></div>
              <div class="flex items-center gap-2 mt-1 text-xs">
                <span class="text-gray-400">Score <span x-text="risk?.summary?.risk_score"></span></span>
                <span x-show="risk?.summary?.error_count" class="text-red-500 font-medium"><span x-text="risk?.summary?.error_count"></span> エラー</span>
                <span x-show="risk?.summary?.warning_count" class="text-yellow-600 font-medium"><span x-text="risk?.summary?.warning_count"></span> 警告</span>
              </div>
            </div>
            <div class="bg-white rounded-xl border p-4">
              <div class="text-xs text-gray-500 mb-1"><i class="fas fa-clipboard-check mr-1"></i>入力完了率</div>
              <div class="text-2xl font-bold text-gray-800"><span x-text="risk?.input_completion?.overall_rate || 0"></span>%</div>
              <div class="w-full bg-gray-200 rounded-full h-2 mt-2"><div class="bg-hm-500 h-2 rounded-full bar-animate transition-all" :style="'width:' + (risk?.input_completion?.overall_rate||0) + '%'"></div></div>
              <div class="text-xs text-gray-400 mt-1">必須 <span x-text="risk?.input_completion?.required_rate || 0"></span>%</div>
            </div>
            <div class="bg-white rounded-xl border p-4">
              <div class="text-xs text-gray-500 mb-1"><i class="fas fa-check-double mr-1"></i>レビュー進捗</div>
              <div class="text-2xl font-bold text-gray-800"><span x-text="risk?.review_progress?.confirmed || 0"></span><span class="text-sm text-gray-400 font-normal"> / <span x-text="risk?.review_progress?.total_items || 0"></span></span></div>
              <div class="w-full bg-gray-200 rounded-full h-2 mt-2"><div class="bg-blue-500 h-2 rounded-full bar-animate transition-all" :style="'width:' + (risk?.review_progress?.rate||0) + '%'"></div></div>
              <div class="text-xs text-gray-400 mt-1"><span x-text="risk?.review_progress?.rate || 0"></span>% 完了</div>
            </div>
            <div class="bg-white rounded-xl border p-4">
              <div class="text-xs text-gray-500 mb-1"><i class="fas fa-yen-sign mr-1"></i>粗利率</div>
              <div class="text-2xl font-bold" :class="risk?.sales_gap ? (risk.sales_gap.overall_margin_rate >= 25 ? 'text-green-600' : risk.sales_gap.overall_margin_rate >= 15 ? 'text-yellow-600' : 'text-red-600') : 'text-gray-300'">
                <span x-text="risk?.sales_gap ? risk.sales_gap.overall_margin_rate + '%' : '未設定'"></span>
              </div>
              <div class="text-xs text-gray-400 mt-1" x-text="risk?.sales_gap ? '期待 ' + risk.sales_gap.expected_margin_rate + '%' : '売価未登録'"></div>
            </div>
          </div>

          <!-- Risk Items List (ordered by severity) -->
          <div class="space-y-2">
            <h3 class="text-sm font-semibold text-gray-700 mb-2"><i class="fas fa-list-ul mr-1"></i>リスク項目 (<span x-text="risk?.risks?.length || 0"></span>)</h3>
            <template x-for="r in risk?.risks || []" :key="r.id">
              <div class="bg-white rounded-lg border p-4 flex items-start gap-3 transition hover:shadow-sm"
                :class="{'border-red-200 bg-red-50/30': r.severity==='error', 'border-yellow-200 bg-yellow-50/30': r.severity==='warning', 'border-blue-200 bg-blue-50/30': r.severity==='info'}">
                <div class="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
                  :class="{'bg-red-100': r.severity==='error', 'bg-yellow-100': r.severity==='warning', 'bg-blue-100': r.severity==='info'}">
                  <i :class="{'fas fa-times-circle text-red-500': r.severity==='error', 'fas fa-exclamation-triangle text-yellow-500': r.severity==='warning', 'fas fa-info-circle text-blue-400': r.severity==='info'}"></i>
                </div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="font-medium text-sm text-gray-800" x-text="r.title"></span>
                    <span class="px-1.5 py-0.5 text-xs rounded font-medium"
                      :class="{'bg-red-100 text-red-700': r.category==='sales', 'bg-purple-100 text-purple-700': r.category==='ai', 'bg-blue-100 text-blue-700': r.category==='regeneration', 'bg-gray-100 text-gray-600': r.category==='input' || r.category==='system', 'bg-orange-100 text-orange-700': r.category==='review'}"
                      x-text="r.category"></span>
                  </div>
                  <p class="text-xs text-gray-500 mt-0.5 truncate" x-text="r.description"></p>
                </div>
                <div class="flex-shrink-0">
                  <span x-show="r.action_required" class="px-2 py-1 bg-red-100 text-red-700 text-xs rounded-full font-medium">
                    <i class="fas fa-bolt mr-0.5"></i>要対応
                  </span>
                </div>
              </div>
            </template>
            <div x-show="!risk?.risks?.length" class="bg-white rounded-lg border p-8 text-center text-gray-400">
              <i class="fas fa-check-circle text-3xl text-green-400 mb-2"></i>
              <p>リスク項目はありません</p>
            </div>
          </div>
        </div>
      </div>

      <!-- ═══════════════════════════════════════ -->
      <!-- TAB 2: Cost Items (工種明細 + 編集Modal) -->
      <!-- ═══════════════════════════════════════ -->
      <div x-show="activeTab === 'items'" class="fade-in">
        <!-- Filter Bar -->
        <div class="flex items-center justify-between mb-4">
          <div class="flex gap-2">
            <input x-model="itemSearch" class="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-64 focus:ring-2 focus:ring-hm-500" placeholder="工種名で検索...">
            <select x-model="itemReviewFilter" class="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-hm-500">
              <option value="">全ステータス</option>
              <option value="pending">未確認</option>
              <option value="confirmed">確認済</option>
              <option value="needs_review">要確認</option>
              <option value="flagged">フラグ</option>
            </select>
          </div>
          <div class="text-sm text-gray-500">
            <span x-text="filteredItems().length"></span> / <span x-text="items.length"></span> 件
          </div>
        </div>

        <!-- Items Table -->
        <div class="bg-white rounded-xl shadow-sm border overflow-hidden">
          <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-gray-200">
              <thead class="bg-gray-50">
                <tr>
                  <th class="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 w-24">カテゴリ</th>
                  <th class="px-3 py-2.5 text-left text-xs font-semibold text-gray-500">明細名</th>
                  <th class="px-3 py-2.5 text-right text-xs font-semibold text-gray-500 w-28">数量</th>
                  <th class="px-3 py-2.5 text-right text-xs font-semibold text-gray-500 w-28">自動金額</th>
                  <th class="px-3 py-2.5 text-right text-xs font-semibold text-gray-500 w-28">最終金額</th>
                  <th class="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 w-20">状態</th>
                  <th class="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 w-16">操作</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100">
                <template x-for="item in filteredItems()" :key="item.id">
                  <tr class="hover:bg-gray-50 text-sm cursor-pointer transition" @click="openEditModal(item)">
                    <td class="px-3 py-2.5 text-xs text-gray-500 font-mono" x-text="item.category_code"></td>
                    <td class="px-3 py-2.5">
                      <div class="text-gray-800 font-medium" x-text="item.item_name"></div>
                      <div x-show="item.override_reason" class="text-xs text-orange-500 mt-0.5 truncate max-w-xs" x-text="item.override_reason"></div>
                    </td>
                    <td class="px-3 py-2.5 text-right font-mono text-xs">
                      <span x-text="item.final_quantity || '-'"></span>
                      <span class="text-gray-400 ml-0.5" x-text="item.unit || ''"></span>
                    </td>
                    <td class="px-3 py-2.5 text-right text-gray-500" x-text="fmt.yen(item.auto_amount)"></td>
                    <td class="px-3 py-2.5 text-right font-semibold" :class="item.manual_amount != null ? 'text-orange-600' : 'text-gray-800'" x-text="fmt.yen(item.final_amount)"></td>
                    <td class="px-3 py-2.5 text-center">
                      <span class="px-2 py-0.5 text-xs rounded-full font-medium"
                        :class="{'bg-green-100 text-green-700':item.review_status==='confirmed','bg-gray-100 text-gray-600':item.review_status==='pending','bg-yellow-100 text-yellow-700':item.review_status==='needs_review','bg-red-100 text-red-700':item.review_status==='flagged'}"
                        x-text="fmt.reviewStatus(item.review_status)"></span>
                    </td>
                    <td class="px-3 py-2.5 text-center" @click.stop>
                      <button @click="openEditModal(item)" class="text-hm-600 hover:text-hm-800 transition" title="編集">
                        <i class="fas fa-pen-to-square"></i>
                      </button>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
          <div x-show="items.length === 0" class="py-12 text-center text-gray-400">
            <i class="fas fa-calculator text-3xl mb-2"></i><p>スナップショットを作成してください</p>
          </div>
        </div>

        <!-- ── Cost Item Edit Modal ── -->
        <div x-show="editModal.show" x-cloak class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" @click.self="editModal.show=false">
          <div class="bg-white rounded-2xl shadow-2xl w-full max-w-xl p-6 slide-in max-h-[90vh] overflow-y-auto" @click.stop>
            <div class="flex justify-between items-center mb-4">
              <h2 class="text-lg font-bold"><i class="fas fa-pen-to-square mr-2 text-hm-600"></i>工種明細 編集</h2>
              <button @click="editModal.show=false" class="text-gray-400 hover:text-gray-600"><i class="fas fa-times"></i></button>
            </div>

            <!-- Item Info -->
            <div class="bg-gray-50 rounded-lg p-3 mb-4">
              <div class="font-medium text-gray-800" x-text="editModal.item?.item_name"></div>
              <div class="flex gap-3 text-xs text-gray-500 mt-1">
                <span x-text="editModal.item?.category_code"></span>
                <span>自動: <span class="font-mono" x-text="fmt.yen(editModal.item?.auto_amount)"></span></span>
                <span>現在: <span class="font-mono font-semibold" x-text="fmt.yen(editModal.item?.final_amount)"></span></span>
              </div>
            </div>

            <!-- Edit Fields -->
            <div class="space-y-4">
              <div class="grid grid-cols-3 gap-3">
                <div>
                  <label class="block text-xs font-medium text-gray-500 mb-1">手修正 数量</label>
                  <input x-model.number="editModal.form.manual_quantity" type="number" step="0.01"
                    class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500"
                    :placeholder="editModal.item?.auto_quantity || ''">
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-500 mb-1">手修正 単価</label>
                  <input x-model.number="editModal.form.manual_unit_price" type="number"
                    class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500"
                    :placeholder="editModal.item?.auto_unit_price || ''">
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-500 mb-1">手修正 金額</label>
                  <input x-model.number="editModal.form.manual_amount" type="number"
                    class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500"
                    :placeholder="editModal.item?.auto_amount || ''">
                </div>
              </div>

              <div>
                <label class="block text-xs font-medium text-gray-500 mb-1">変更理由カテゴリ</label>
                <select x-model="editModal.form.override_reason_category" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500">
                  <option value="">未選択</option>
                  <option value="site_condition">現場条件</option>
                  <option value="customer_request">顧客要望</option>
                  <option value="regulatory">法規制</option>
                  <option value="spec_change">仕様変更</option>
                  <option value="price_update">価格改定</option>
                  <option value="correction">訂正</option>
                  <option value="vendor_quote">業者見積</option>
                  <option value="other">その他</option>
                </select>
              </div>

              <div>
                <label class="block text-xs font-medium text-gray-500 mb-1">変更理由（詳細）</label>
                <textarea x-model="editModal.form.override_reason" rows="2"
                  class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500"
                  placeholder="変更理由を記入..."></textarea>
              </div>

              <div>
                <label class="block text-xs font-medium text-gray-500 mb-1">メモ</label>
                <textarea x-model="editModal.form.note" rows="2"
                  class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500"
                  placeholder="備考・メモ"></textarea>
              </div>

              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="block text-xs font-medium text-gray-500 mb-1">レビューステータス</label>
                  <select x-model="editModal.form.review_status" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500">
                    <option value="">変更なし</option>
                    <option value="pending">未確認</option>
                    <option value="confirmed">確認済</option>
                    <option value="needs_review">要確認</option>
                    <option value="flagged">フラグ</option>
                  </select>
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-500 mb-1">業者名</label>
                  <input x-model="editModal.form.vendor_name" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500" placeholder="業者名">
                </div>
              </div>
            </div>

            <!-- Preview Change -->
            <div x-show="editModal.form.manual_amount || editModal.form.manual_quantity || editModal.form.manual_unit_price"
              class="bg-orange-50 border border-orange-200 rounded-lg p-3 mt-4 text-sm">
              <div class="font-medium text-orange-800 mb-1"><i class="fas fa-info-circle mr-1"></i>変更プレビュー</div>
              <div class="flex gap-4 text-xs">
                <span>現在: <span class="font-mono" x-text="fmt.yen(editModal.item?.final_amount)"></span></span>
                <span x-show="editModal.form.manual_amount">→ 手修正額: <span class="font-mono font-bold text-orange-700" x-text="fmt.yen(editModal.form.manual_amount)"></span></span>
              </div>
            </div>

            <div class="flex justify-end gap-2 mt-5">
              <button @click="editModal.show=false" class="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition">キャンセル</button>
              <button @click="saveItemEdit()" class="px-5 py-2 text-sm bg-hm-600 text-white rounded-lg hover:bg-hm-700 transition font-medium" :disabled="editModal.saving">
                <span x-show="!editModal.saving"><i class="fas fa-save mr-1"></i>保存</span>
                <span x-show="editModal.saving"><i class="fas fa-spinner fa-spin mr-1"></i>保存中...</span>
              </button>
            </div>
            <div x-show="editModal.error" class="mt-3 p-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600" x-text="editModal.error"></div>
          </div>
        </div>
      </div>

      <!-- ═══════════════════════════════════════ -->
      <!-- TAB 3: Diff Resolution (差分解決)        -->
      <!-- ═══════════════════════════════════════ -->
      <div x-show="activeTab === 'diffs'" class="fade-in">
        <!-- Summary Bar -->
        <div x-show="diffMeta" class="flex items-center gap-4 mb-4 bg-white rounded-lg border p-3">
          <div class="text-sm"><span class="font-semibold" x-text="diffMeta?.total || 0"></span> 件の差分</div>
          <div class="flex gap-2 text-xs">
            <span class="px-2 py-0.5 bg-red-100 text-red-700 rounded-full">重要 <span x-text="diffMeta?.significant || 0"></span></span>
            <span class="px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded-full">pending <span x-text="diffMeta?.pending || 0"></span></span>
            <span class="px-2 py-0.5 bg-green-100 text-green-700 rounded-full">解決済 <span x-text="diffMeta?.resolved || 0"></span></span>
          </div>
          <div class="flex-1"></div>
          <select x-model="diffFilter" @change="loadDiffs()" class="border border-gray-300 rounded-lg px-2 py-1 text-xs">
            <option value="">全件</option>
            <option value="pending">未解決のみ</option>
            <option value="significant">重要のみ</option>
          </select>
        </div>

        <!-- No Diffs -->
        <div x-show="diffs.length === 0 && !diffsLoading" class="bg-white rounded-xl border p-12 text-center text-gray-400">
          <i class="fas fa-check-circle text-4xl text-green-400 mb-3"></i>
          <p class="text-lg font-medium text-gray-600">未解決の差分はありません</p>
          <p class="text-sm mt-1">再計算すると新しい差分が検出されます</p>
        </div>

        <!-- Diff Cards -->
        <div class="space-y-3">
          <template x-for="d in diffs" :key="d.id">
            <div class="bg-white rounded-lg border p-4 transition hover:shadow-sm"
              :class="{'border-red-300 shadow-red-50': d.is_significant && d.resolution_status==='pending', 'border-gray-200': !d.is_significant || d.resolution_status!=='pending', 'opacity-60': d.resolution_status!=='pending'}">
              <div class="flex justify-between items-start">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 mb-1">
                    <span class="font-semibold text-sm text-gray-800" x-text="d.item_name"></span>
                    <span x-show="d.is_significant" class="px-1.5 py-0.5 bg-red-100 text-red-600 rounded text-xs font-bold">重要</span>
                    <span class="px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-xs" x-text="fmt.diffType(d.diff_type)"></span>
                  </div>
                  <div class="text-xs text-gray-500 font-mono" x-text="d.category_code"></div>
                  <div class="grid grid-cols-3 gap-4 mt-2 text-sm">
                    <div>
                      <span class="text-xs text-gray-400">旧金額</span>
                      <div class="font-mono" x-text="fmt.yen(d.old_amount)"></div>
                    </div>
                    <div>
                      <span class="text-xs text-gray-400">新金額</span>
                      <div class="font-mono" x-text="fmt.yen(d.new_amount)"></div>
                    </div>
                    <div>
                      <span class="text-xs text-gray-400">変動</span>
                      <div class="font-mono font-semibold" :class="d.change_amount > 0 ? 'text-red-600' : 'text-green-600'">
                        <span x-text="(d.change_amount > 0 ? '+' : '') + fmt.yen(d.change_amount)"></span>
                        <span class="text-xs ml-1" x-text="'(' + (d.change_percent > 0 ? '+' : '') + d.change_percent + '%)'"></span>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Actions or Status -->
                <div class="flex-shrink-0 ml-4">
                  <div x-show="d.resolution_status === 'pending'" class="flex flex-col gap-1.5">
                    <button @click="resolveDiff(d.id, 'adopt_candidate')" class="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium">
                      <i class="fas fa-check mr-1"></i>新値採用
                    </button>
                    <button @click="resolveDiff(d.id, 'keep_current')" class="px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition font-medium">
                      <i class="fas fa-arrow-left mr-1"></i>旧値維持
                    </button>
                    <button @click="resolveDiff(d.id, 'dismiss')" class="px-3 py-1.5 text-xs bg-yellow-100 text-yellow-700 rounded-lg hover:bg-yellow-200 transition font-medium">
                      <i class="fas fa-ban mr-1"></i>却下
                    </button>
                    <button @click="openManualAdjust(d)" class="px-3 py-1.5 text-xs bg-orange-100 text-orange-700 rounded-lg hover:bg-orange-200 transition font-medium">
                      <i class="fas fa-sliders-h mr-1"></i>手動調整
                    </button>
                  </div>
                  <div x-show="d.resolution_status !== 'pending'" class="text-center">
                    <span class="px-2.5 py-1 text-xs rounded-full font-semibold"
                      :class="{'bg-blue-100 text-blue-700':d.resolution_status==='adopted','bg-gray-200 text-gray-600':d.resolution_status==='kept','bg-yellow-100 text-yellow-600':d.resolution_status==='dismissed','bg-orange-100 text-orange-700':d.resolution_status==='manual_adjusted'}"
                      x-text="d.resolution_status"></span>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>

        <!-- Manual Adjust Modal -->
        <div x-show="manualAdjust.show" x-cloak class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" @click.self="manualAdjust.show=false">
          <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 slide-in" @click.stop>
            <h3 class="font-bold mb-3"><i class="fas fa-sliders-h mr-2 text-orange-600"></i>手動金額調整</h3>
            <div class="bg-gray-50 rounded-lg p-3 mb-4 text-sm">
              <div class="font-medium" x-text="manualAdjust.diff?.item_name"></div>
              <div class="flex gap-4 text-xs mt-1">
                <span>旧: <span class="font-mono" x-text="fmt.yen(manualAdjust.diff?.old_amount)"></span></span>
                <span>新: <span class="font-mono" x-text="fmt.yen(manualAdjust.diff?.new_amount)"></span></span>
              </div>
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-500 mb-1">調整後金額</label>
              <input x-model.number="manualAdjust.amount" type="number" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500">
            </div>
            <div class="flex justify-end gap-2 mt-4">
              <button @click="manualAdjust.show=false" class="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">キャンセル</button>
              <button @click="submitManualAdjust()" class="px-4 py-2 text-sm bg-orange-600 text-white rounded-lg hover:bg-orange-700 font-medium">確定</button>
            </div>
          </div>
        </div>
      </div>

      <!-- ═══════════════════════════════════════ -->
      <!-- TAB 4: Cost Summary (原価サマリ)         -->
      <!-- ═══════════════════════════════════════ -->
      <div x-show="activeTab === 'summary'" class="fade-in">
        <!-- Totals Cards -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
          <div class="bg-white rounded-xl border p-4 text-center">
            <div class="text-xs text-gray-500 mb-1">原価合計</div>
            <div class="text-xl font-bold text-gray-800" x-text="fmt.yen(snapshot?.total_cost)"></div>
          </div>
          <div class="bg-white rounded-xl border p-4 text-center">
            <div class="text-xs text-gray-500 mb-1">標準原価</div>
            <div class="text-xl font-bold text-blue-700" x-text="fmt.yen(snapshot?.total_standard_cost)"></div>
          </div>
          <div class="bg-white rounded-xl border p-4 text-center">
            <div class="text-xs text-gray-500 mb-1">太陽光原価</div>
            <div class="text-xl font-bold text-yellow-600" x-text="fmt.yen(snapshot?.total_solar_cost)"></div>
          </div>
          <div class="bg-white rounded-xl border p-4 text-center">
            <div class="text-xs text-gray-500 mb-1">オプション原価</div>
            <div class="text-xl font-bold text-purple-600" x-text="fmt.yen(snapshot?.total_option_cost)"></div>
          </div>
        </div>

        <!-- Category Table -->
        <div class="bg-white rounded-xl shadow-sm border overflow-hidden">
          <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500">カテゴリ</th>
                <th class="px-4 py-3 text-right text-xs font-semibold text-gray-500">自動合計</th>
                <th class="px-4 py-3 text-right text-xs font-semibold text-gray-500">手動調整</th>
                <th class="px-4 py-3 text-right text-xs font-semibold text-gray-500">最終合計</th>
                <th class="px-4 py-3 text-right text-xs font-semibold text-gray-500">構成比</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              <template x-for="s in summaries" :key="s.category_code">
                <tr class="hover:bg-gray-50 text-sm">
                  <td class="px-4 py-3">
                    <span class="font-medium text-gray-800" x-text="s.category_code"></span>
                  </td>
                  <td class="px-4 py-3 text-right text-gray-500 font-mono" x-text="fmt.yen(s.auto_total_amount)"></td>
                  <td class="px-4 py-3 text-right font-mono" :class="s.manual_adjustment_amount ? 'text-orange-600 font-semibold' : 'text-gray-300'" x-text="fmt.yen(s.manual_adjustment_amount || 0)"></td>
                  <td class="px-4 py-3 text-right font-mono font-semibold text-gray-800" x-text="fmt.yen(s.final_total_amount)"></td>
                  <td class="px-4 py-3 text-right">
                    <div class="flex items-center justify-end gap-2">
                      <div class="w-16 bg-gray-200 rounded-full h-1.5"><div class="bg-hm-500 h-1.5 rounded-full" :style="'width:' + (snapshot?.total_cost ? Math.round(s.final_total_amount / snapshot.total_cost * 100) : 0) + '%'"></div></div>
                      <span class="text-xs text-gray-400 w-10 text-right" x-text="snapshot?.total_cost ? Math.round(s.final_total_amount / snapshot.total_cost * 100) + '%' : '-'"></span>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
            <tfoot class="bg-gray-50">
              <tr class="font-bold text-sm">
                <td class="px-4 py-3">合計</td>
                <td class="px-4 py-3 text-right font-mono" x-text="fmt.yen(summaries.reduce((a,s)=>a+(s.auto_total_amount||0),0))"></td>
                <td class="px-4 py-3 text-right font-mono text-orange-600" x-text="fmt.yen(summaries.reduce((a,s)=>a+(s.manual_adjustment_amount||0),0))"></td>
                <td class="px-4 py-3 text-right font-mono" x-text="fmt.yen(snapshot?.total_cost)"></td>
                <td class="px-4 py-3 text-right text-gray-500">100%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <!-- ═══════════════════════════════════════ -->
      <!-- TAB 5: Sales Estimate (売価見積)         -->
      <!-- ═══════════════════════════════════════ -->
      <div x-show="activeTab === 'sales'" class="fade-in space-y-5">
        <!-- Input Form -->
        <div class="bg-white rounded-xl border p-5">
          <h3 class="font-semibold mb-3"><i class="fas fa-yen-sign mr-1.5 text-hm-600"></i>売価見積もり登録</h3>
          <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div>
              <label class="block text-xs font-medium text-gray-500 mb-1">種別</label>
              <select x-model="salesForm.estimate_type" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500">
                <option value="rough">概算</option><option value="internal">社内</option>
                <option value="contract">契約</option><option value="execution">実行</option>
              </select>
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-500 mb-1">売価合計</label>
              <input x-model.number="salesForm.total_sale_price" type="number" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500" placeholder="0">
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-500 mb-1">標準売価</label>
              <input x-model.number="salesForm.standard_sale" type="number" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500">
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-500 mb-1">太陽光売価</label>
              <input x-model.number="salesForm.solar_sale" type="number" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-hm-500">
            </div>
            <div class="flex items-end">
              <button @click="createSalesEstimate()" class="w-full bg-hm-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-hm-700 transition font-medium" :disabled="salesSaving">
                <span x-show="!salesSaving"><i class="fas fa-paper-plane mr-1"></i>登録</span>
                <span x-show="salesSaving"><i class="fas fa-spinner fa-spin"></i></span>
              </button>
            </div>
          </div>
        </div>

        <!-- Gap Analysis Card -->
        <div x-show="gap" class="bg-white rounded-xl border p-5">
          <h3 class="font-semibold mb-3"><i class="fas fa-chart-bar mr-1.5 text-blue-600"></i>乖離分析</h3>
          <div class="grid grid-cols-2 md:grid-cols-5 gap-4 mb-3">
            <div><div class="text-xs text-gray-500">原価合計</div><div class="text-lg font-bold font-mono" x-text="fmt.yen(gap?.total_cost)"></div></div>
            <div><div class="text-xs text-gray-500">売価合計</div><div class="text-lg font-bold font-mono" x-text="fmt.yen(gap?.total_sale_price)"></div></div>
            <div><div class="text-xs text-gray-500">差額</div><div class="text-lg font-bold font-mono" :class="gap?.gap_amount >= 0 ? 'text-green-600' : 'text-red-600'" x-text="fmt.yen(gap?.gap_amount)"></div></div>
            <div><div class="text-xs text-gray-500">粗利率</div><div class="text-lg font-bold" :class="gap?.overall_margin_rate >= 25 ? 'text-green-600' : gap?.overall_margin_rate >= 15 ? 'text-yellow-600' : 'text-red-600'" x-text="fmt.pct(gap?.overall_margin_rate)"></div></div>
            <div><div class="text-xs text-gray-500">判定</div>
              <span class="px-3 py-1 rounded-full text-sm font-bold"
                :class="{'bg-green-100 text-green-700':gap?.severity==='ok','bg-yellow-100 text-yellow-700':gap?.severity==='warning','bg-red-100 text-red-700':gap?.severity==='error'}"
                x-text="gap?.severity==='ok' ? 'OK' : gap?.severity==='warning' ? '注意' : 'NG'"></span>
            </div>
          </div>
          <!-- Group Breakdown -->
          <div class="grid grid-cols-3 gap-3 mt-3 border-t pt-3">
            <template x-for="g in [{key:'standard_gap', label:'標準'},{key:'solar_gap', label:'太陽光'},{key:'option_gap', label:'オプション'}]" :key="g.key">
              <div class="text-xs">
                <div class="font-medium text-gray-700 mb-1" x-text="g.label"></div>
                <div class="flex justify-between"><span class="text-gray-400">原価</span><span class="font-mono" x-text="fmt.yen(gap?.[g.key]?.cost)"></span></div>
                <div class="flex justify-between"><span class="text-gray-400">売価</span><span class="font-mono" x-text="fmt.yen(gap?.[g.key]?.sale)"></span></div>
                <div class="flex justify-between"><span class="text-gray-400">粗利</span>
                  <span class="font-mono font-semibold" :class="gap?.[g.key]?.actual_margin >= gap?.[g.key]?.expected_margin ? 'text-green-600' : 'text-red-600'"
                    x-text="fmt.pct(gap?.[g.key]?.actual_margin)"></span>
                </div>
              </div>
            </template>
          </div>
        </div>

        <!-- Estimate History -->
        <div x-show="salesEstimates.length > 0" class="bg-white rounded-xl border overflow-hidden">
          <h3 class="font-semibold p-4 pb-2"><i class="fas fa-history mr-1.5 text-gray-500"></i>見積履歴</h3>
          <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-4 py-2 text-left text-xs font-medium text-gray-500">種別</th>
                <th class="px-4 py-2 text-right text-xs font-medium text-gray-500">売価</th>
                <th class="px-4 py-2 text-right text-xs font-medium text-gray-500">粗利率</th>
                <th class="px-4 py-2 text-center text-xs font-medium text-gray-500">現行</th>
                <th class="px-4 py-2 text-left text-xs font-medium text-gray-500">日時</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              <template x-for="e in salesEstimates" :key="e.id">
                <tr class="text-sm hover:bg-gray-50">
                  <td class="px-4 py-2"><span class="px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700" x-text="fmt.estimateType(e.estimate_type)"></span></td>
                  <td class="px-4 py-2 text-right font-mono" x-text="fmt.yen(e.total_sale_price)"></td>
                  <td class="px-4 py-2 text-right font-mono" :class="e.gross_margin_rate >= 25 ? 'text-green-600' : 'text-red-600'" x-text="fmt.pct(e.gross_margin_rate)"></td>
                  <td class="px-4 py-2 text-center"><i x-show="e.is_current" class="fas fa-check text-green-500"></i></td>
                  <td class="px-4 py-2 text-gray-400 text-xs" x-text="fmt.datetime(e.created_at)"></td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </div>

      <!-- ═══════════════════════════════════════ -->
      <!-- TAB 6: AI Warnings (AI警告パネル)        -->
      <!-- ═══════════════════════════════════════ -->
      <div x-show="activeTab === 'ai'" class="fade-in space-y-5">
        <!-- AI Status -->
        <div class="bg-white rounded-xl border p-4 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
              <i class="fas fa-robot text-purple-600"></i>
            </div>
            <div>
              <div class="font-semibold text-sm" x-text="aiStatus?.phase === 'phase_1_staging' ? 'AI Phase 1 (Staging)' : 'AI'"></div>
              <div class="text-xs text-gray-500" x-text="aiStatus?.openai_configured ? 'OpenAI API 接続済' : 'ルールベース分析モード'"></div>
            </div>
          </div>
          <div class="flex gap-2">
            <button @click="runAiCheck()" class="px-3 py-1.5 text-xs bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition font-medium" :disabled="aiChecking">
              <span x-show="!aiChecking"><i class="fas fa-search mr-1"></i>条件チェック</span>
              <span x-show="aiChecking"><i class="fas fa-spinner fa-spin"></i></span>
            </button>
          </div>
        </div>

        <!-- AI Check Results -->
        <div x-show="aiCheckResult" class="bg-white rounded-xl border p-5">
          <h3 class="font-semibold mb-3"><i class="fas fa-clipboard-list mr-1.5 text-purple-600"></i>AI条件チェック結果</h3>
          <div class="flex gap-4 mb-3 text-sm">
            <span class="px-2 py-1 bg-gray-100 rounded text-xs">モード: <span class="font-semibold" x-text="aiCheckResult?.mode"></span></span>
            <span class="px-2 py-1 bg-gray-100 rounded text-xs">ルール: <span class="font-semibold" x-text="aiCheckResult?.total_rules_checked"></span></span>
            <span class="px-2 py-1 bg-orange-100 text-orange-700 rounded text-xs">未達: <span class="font-semibold" x-text="aiCheckResult?.unmet_count"></span></span>
          </div>
          <div class="space-y-2 max-h-80 overflow-y-auto">
            <template x-for="u in (aiCheckResult?.unmet_conditions || []).slice(0, 20)" :key="u.rule_id + '_' + u.field">
              <div class="p-2 bg-orange-50 border border-orange-100 rounded-lg text-xs">
                <div class="font-medium text-orange-800" x-text="u.suggestion"></div>
                <div class="text-orange-600 mt-0.5">ルール: <span x-text="u.rule_name"></span> (<span x-text="u.rule_group"></span>)</div>
              </div>
            </template>
          </div>
        </div>

        <!-- System Warnings from Snapshot -->
        <div x-show="warnings.length > 0" class="bg-white rounded-xl border p-5">
          <h3 class="font-semibold mb-3"><i class="fas fa-exclamation-triangle mr-1.5 text-yellow-500"></i>システム警告 (<span x-text="warnings.length"></span>)</h3>
          <div class="space-y-2 max-h-96 overflow-y-auto">
            <template x-for="w in warnings" :key="w.id">
              <div class="p-3 rounded-lg border text-sm flex items-start gap-3"
                :class="{'bg-red-50 border-red-200':w.severity==='error','bg-yellow-50 border-yellow-200':w.severity==='warning','bg-blue-50 border-blue-200':w.severity==='info'}">
                <i :class="{'fas fa-times-circle text-red-500':w.severity==='error','fas fa-exclamation-triangle text-yellow-500':w.severity==='warning','fas fa-info-circle text-blue-400':w.severity==='info'}" class="mt-0.5"></i>
                <div class="flex-1 min-w-0">
                  <div class="font-medium text-gray-800" x-text="w.message"></div>
                  <div class="text-xs text-gray-500 mt-0.5 flex gap-2">
                    <span x-text="w.warning_type"></span>
                    <span x-text="w.source"></span>
                    <span x-show="w.recommendation" class="text-blue-600" x-text="w.recommendation"></span>
                  </div>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>

      <!-- ═══════════════════════════════════════ -->
      <!-- Regenerate Modal                         -->
      <!-- ═══════════════════════════════════════ -->
      <div x-show="showRegenModal" x-cloak class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" @click.self="showRegenModal=false">
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 slide-in" @click.stop>
          <h2 class="text-lg font-bold mb-4"><i class="fas fa-sync-alt mr-2 text-blue-600"></i>スナップショット再計算</h2>
          <div class="space-y-3">
            <label class="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-blue-50 transition"
              :class="regenMode === 'regenerate_preserve_reviewed' ? 'border-blue-500 bg-blue-50' : ''">
              <input type="radio" x-model="regenMode" value="regenerate_preserve_reviewed" class="mt-1">
              <div>
                <div class="font-medium text-sm">レビュー済保持</div>
                <div class="text-xs text-gray-500">確認済みの項目は保持し、それ以外を再計算</div>
              </div>
            </label>
            <label class="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-blue-50 transition"
              :class="regenMode === 'regenerate_auto_only' ? 'border-blue-500 bg-blue-50' : ''">
              <input type="radio" x-model="regenMode" value="regenerate_auto_only" class="mt-1">
              <div>
                <div class="font-medium text-sm">自動項目のみ</div>
                <div class="text-xs text-gray-500">手修正項目は保持し、自動計算項目のみ再計算</div>
              </div>
            </label>
            <label class="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-red-50 transition"
              :class="regenMode === 'regenerate_replace_all' ? 'border-red-500 bg-red-50' : ''">
              <input type="radio" x-model="regenMode" value="regenerate_replace_all" class="mt-1">
              <div>
                <div class="font-medium text-sm text-red-700">全件置換</div>
                <div class="text-xs text-gray-500">全項目を最新マスタで再計算（管理者のみ）</div>
              </div>
            </label>
          </div>
          <div class="flex justify-end gap-2 mt-5">
            <button @click="showRegenModal=false" class="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">キャンセル</button>
            <button @click="executeRegen()" class="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium" :disabled="enqueueing">
              <span x-show="!enqueueing"><i class="fas fa-play mr-1"></i>実行</span>
              <span x-show="enqueueing"><i class="fas fa-spinner fa-spin mr-1"></i>実行中...</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Toast Notification -->
      <div x-show="toast.show" x-cloak x-transition:enter="toast-enter" x-transition:leave="transition ease-in duration-200" x-transition:leave-start="opacity-100" x-transition:leave-end="opacity-0"
        class="fixed bottom-5 right-5 z-50 max-w-sm">
        <div class="rounded-xl shadow-lg px-4 py-3 flex items-center gap-3"
          :class="{'bg-green-600 text-white': toast.type==='success', 'bg-red-600 text-white': toast.type==='error', 'bg-gray-800 text-white': toast.type==='info'}">
          <i :class="{'fas fa-check-circle': toast.type==='success', 'fas fa-exclamation-circle': toast.type==='error', 'fas fa-info-circle': toast.type==='info'}"></i>
          <span class="text-sm" x-text="toast.message"></span>
        </div>
      </div>
    </div>

    <script>
    function projectDetail(projectId) {
      return {
        // State
        project: null, snapshot: null, items: [], summaries: [], diffs: [], diffMeta: null,
        risk: null, gap: null, warnings: [], salesEstimates: [],
        aiStatus: null, aiCheckResult: null,
        loading: true, enqueueing: false, salesSaving: false, aiChecking: false, diffsLoading: false,
        activeTab: 'risk',
        showRegenModal: false, regenMode: 'regenerate_preserve_reviewed',
        toast: { show: false, message: '', type: 'info' },
        itemSearch: '', itemReviewFilter: '',
        diffFilter: '',

        // Edit modal
        editModal: { show:false, item:null, saving:false, error:'',
          form: { manual_quantity:null, manual_unit_price:null, manual_amount:null,
            override_reason_category:'', override_reason:'', note:'', review_status:'', vendor_name:'' } },

        // Manual adjust modal
        manualAdjust: { show:false, diff:null, amount:0 },

        // Sales form
        salesForm: { estimate_type:'rough', total_sale_price:0, standard_sale:0, solar_sale:0 },

        // Tabs
        tabs: [
          { id:'risk', label:'リスクセンター', icon:'fas fa-shield-alt', badge:0, badgeColor:'bg-red-500 text-white' },
          { id:'items', label:'工種明細', icon:'fas fa-list-alt', badge:0, badgeColor:'bg-gray-200 text-gray-600' },
          { id:'diffs', label:'差分解決', icon:'fas fa-code-compare', badge:0, badgeColor:'bg-orange-500 text-white' },
          { id:'summary', label:'原価サマリ', icon:'fas fa-chart-pie', badge:0, badgeColor:'' },
          { id:'sales', label:'売価見積', icon:'fas fa-yen-sign', badge:0, badgeColor:'' },
          { id:'ai', label:'AI・警告', icon:'fas fa-robot', badge:0, badgeColor:'bg-purple-500 text-white' },
        ],

        statusClass(s) {
          return {'draft':'bg-gray-100 text-gray-600','calculating':'bg-indigo-100 text-indigo-700','in_progress':'bg-blue-100 text-blue-700','needs_review':'bg-yellow-100 text-yellow-700','reviewed':'bg-green-100 text-green-700','archived':'bg-purple-100 text-purple-600'}[s] || 'bg-gray-100 text-gray-600';
        },

        // ── Init ──
        async init() {
          await this.loadAll();
          this.loading = false;
        },

        async loadAll() {
          // Project
          const pRes = await api.get('/projects/' + projectId);
          if (pRes.success) this.project = pRes.data;

          if (this.project?.current_snapshot_id) {
            // Snapshot + Items + Summaries
            const sRes = await api.get('/projects/' + projectId + '/snapshots/' + this.project.current_snapshot_id);
            if (sRes.success) {
              this.snapshot = sRes.data.snapshot;
              this.items = sRes.data.items || [];
              this.summaries = sRes.data.summaries || [];
              this.warnings = sRes.data.warnings || [];
            }

            // Diffs
            await this.loadDiffs();

            // Gap
            const gRes = await api.get('/projects/' + projectId + '/gap-analysis');
            if (gRes.success && gRes.data.has_estimate) this.gap = gRes.data.gap_analysis;

            // Sales estimates
            const seRes = await api.get('/projects/' + projectId + '/sales-estimates');
            if (seRes.success) this.salesEstimates = seRes.data || [];
          }

          // Risk centre
          const rRes = await api.get('/projects/' + projectId + '/risk-centre');
          if (rRes.success) this.risk = rRes.data;

          // AI status
          const aiRes = await api.get('/ai/status');
          if (aiRes.success) this.aiStatus = aiRes.data;

          // Update tab badges
          this.updateBadges();
        },

        async loadDiffs() {
          this.diffsLoading = true;
          let q = '';
          if (this.diffFilter === 'pending') q = '?status=pending';
          else if (this.diffFilter === 'significant') q = '?significant_only=true';
          const dRes = await api.get('/projects/' + projectId + '/diffs' + q);
          if (dRes.success) {
            this.diffs = dRes.data || [];
            this.diffMeta = dRes.meta || { total: this.diffs.length, pending: 0, significant: 0, resolved: 0 };
          }
          this.diffsLoading = false;
        },

        updateBadges() {
          this.tabs[0].badge = this.risk?.summary?.action_required_count || 0;
          this.tabs[1].badge = this.items.length;
          this.tabs[2].badge = this.diffMeta?.pending || 0;
          this.tabs[5].badge = this.warnings.filter(w => w.status === 'open').length;
        },

        onTabChange(tabId) {
          // Refresh data when switching tabs
        },

        // ── Items Filter ──
        filteredItems() {
          let result = this.items;
          if (this.itemSearch) {
            const q = this.itemSearch.toLowerCase();
            result = result.filter(i => (i.item_name||'').toLowerCase().includes(q) || (i.category_code||'').toLowerCase().includes(q));
          }
          if (this.itemReviewFilter) {
            result = result.filter(i => i.review_status === this.itemReviewFilter);
          }
          return result;
        },

        // ── Edit Modal ──
        openEditModal(item) {
          this.editModal.item = item;
          this.editModal.form = {
            manual_quantity: item.manual_quantity,
            manual_unit_price: item.manual_unit_price,
            manual_amount: item.manual_amount,
            override_reason_category: item.override_reason_category || '',
            override_reason: item.override_reason || '',
            note: item.note || '',
            review_status: '',
            vendor_name: item.vendor_name || '',
          };
          this.editModal.error = '';
          this.editModal.show = true;
        },

        async saveItemEdit() {
          this.editModal.saving = true;
          this.editModal.error = '';
          const body = {};
          const f = this.editModal.form;
          if (f.manual_quantity !== this.editModal.item.manual_quantity) body.manual_quantity = f.manual_quantity;
          if (f.manual_unit_price !== this.editModal.item.manual_unit_price) body.manual_unit_price = f.manual_unit_price;
          if (f.manual_amount !== this.editModal.item.manual_amount) body.manual_amount = f.manual_amount;
          if (f.override_reason_category) body.override_reason_category = f.override_reason_category;
          if (f.override_reason) body.override_reason = f.override_reason;
          if (f.note !== (this.editModal.item.note || '')) body.note = f.note;
          if (f.review_status) body.review_status = f.review_status;
          if (f.vendor_name !== (this.editModal.item.vendor_name || '')) body.vendor_name = f.vendor_name;

          if (Object.keys(body).length === 0) {
            this.editModal.error = '変更がありません';
            this.editModal.saving = false;
            return;
          }

          const res = await api.patch('/projects/' + projectId + '/cost-items/' + this.editModal.item.id, body);
          this.editModal.saving = false;
          if (res.success) {
            this.editModal.show = false;
            this.showToast('保存しました', 'success');
            await this.loadAll();
          } else {
            this.editModal.error = res.error || '保存に失敗しました';
          }
        },

        // ── Snapshot ──
        async enqueue(jobType) {
          this.enqueueing = true;
          const res = await api.post('/projects/' + projectId + '/snapshots/enqueue', { job_type: jobType });
          this.enqueueing = false;
          if (res.success) {
            this.showToast('計算が完了しました', 'success');
            await this.loadAll();
          } else {
            this.showToast('エラー: ' + (res.error || ''), 'error');
          }
        },

        async executeRegen() {
          this.showRegenModal = false;
          await this.enqueue(this.regenMode);
        },

        // ── Diff Resolution ──
        async resolveDiff(diffId, action) {
          const res = await api.post('/projects/' + projectId + '/diffs/' + diffId + '/resolve', { action });
          if (res.success) {
            this.showToast('差分を解決しました: ' + action, 'success');
            await this.loadAll();
          } else {
            this.showToast('エラー: ' + (res.error || ''), 'error');
          }
        },

        openManualAdjust(diff) {
          this.manualAdjust.diff = diff;
          this.manualAdjust.amount = diff.new_amount || diff.old_amount || 0;
          this.manualAdjust.show = true;
        },

        async submitManualAdjust() {
          const res = await api.post('/projects/' + projectId + '/diffs/' + this.manualAdjust.diff.id + '/resolve', {
            action: 'manual_adjust',
            manual_amount: this.manualAdjust.amount
          });
          this.manualAdjust.show = false;
          if (res.success) {
            this.showToast('手動調整を適用しました', 'success');
            await this.loadAll();
          } else {
            this.showToast('エラー: ' + (res.error || ''), 'error');
          }
        },

        // ── Sales Estimate ──
        async createSalesEstimate() {
          this.salesSaving = true;
          const res = await api.post('/projects/' + projectId + '/sales-estimates', this.salesForm);
          this.salesSaving = false;
          if (res.success) {
            this.showToast('売価見積もりを登録しました', 'success');
            this.gap = res.data?.gap_analysis;
            await this.loadAll();
          } else {
            this.showToast('エラー: ' + (res.error || ''), 'error');
          }
        },

        // ── AI ──
        async runAiCheck() {
          this.aiChecking = true;
          const res = await api.post('/ai/check-conditions', { project_id: projectId });
          this.aiChecking = false;
          if (res.success) {
            this.aiCheckResult = res.data;
            this.showToast('AI条件チェック完了', 'success');
          } else {
            this.showToast('エラー: ' + (res.error || ''), 'error');
          }
        },

        // ── Toast ──
        showToast(message, type = 'info') {
          this.toast = { show: true, message, type };
          setTimeout(() => { this.toast.show = false; }, 3500);
        },
      };
    }
    </script>
  `, 'projects'));
});

export default uiRoutes;
