// ==============================================
// Frontend UI Routes (Step 4.4)
// SPA-style pages rendered from Hono
// Priority order: project list → detail → risk centre →
//   trade detail → diff resolution → cost summary
// ==============================================
import { Hono } from 'hono';
import type { AppEnv } from '../types/bindings';

const uiRoutes = new Hono<AppEnv>();

// Shared layout wrapper
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
    .fade-in { animation: fadeIn 0.3s ease-in; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    .risk-critical { border-left: 4px solid #ef4444; }
    .risk-high { border-left: 4px solid #f97316; }
    .risk-medium { border-left: 4px solid #eab308; }
    .risk-low { border-left: 4px solid #22c55e; }
  </style>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            hm: { 50: '#f0fdf4', 100: '#dcfce7', 500: '#22c55e', 600: '#16a34a', 700: '#15803d', 800: '#166534', 900: '#14532d' }
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
          <a href="/" class="flex items-center space-x-2">
            <i class="fas fa-building text-hm-600 text-lg"></i>
            <span class="font-bold text-gray-800">平松建築 原価管理</span>
          </a>
          <div class="hidden md:flex space-x-1">
            <a href="/ui/projects" class="px-3 py-2 rounded-md text-sm font-medium ${activeTab === 'projects' ? 'bg-hm-50 text-hm-700' : 'text-gray-600 hover:bg-gray-100'}">
              <i class="fas fa-folder-open mr-1"></i>案件一覧
            </a>
          </div>
        </div>
        <div class="flex items-center space-x-3">
          <span class="text-xs text-gray-400">v0.4.0 Step 4</span>
          <a href="/api/health" class="text-xs text-gray-400 hover:text-gray-600"><i class="fas fa-heartbeat mr-1"></i>API</a>
        </div>
      </div>
    </div>
  </nav>
  
  <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
    ${bodyContent}
  </main>

  <script>
    // Shared utilities
    const api = {
      async get(path) { const r = await fetch('/api' + path); return r.json(); },
      async post(path, body) { const r = await fetch('/api' + path, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) }); return r.json(); },
      async patch(path, body) { const r = await fetch('/api' + path, { method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) }); return r.json(); },
    };
    const fmt = {
      yen(n) { return n != null ? '¥' + Math.round(n).toLocaleString() : '-'; },
      pct(n) { return n != null ? n.toFixed(1) + '%' : '-'; },
      date(s) { return s ? new Date(s).toLocaleDateString('ja-JP') : '-'; },
    };
  </script>
</body>
</html>`;
}

// ==========================================================
// / — Home (redirect to projects)
// ==========================================================
uiRoutes.get('/', (c) => c.redirect('/ui/projects'));

// ==========================================================
// /ui/projects — Project List
// ==========================================================
uiRoutes.get('/ui/projects', (c) => {
  return c.html(layout('案件一覧', `
    <div x-data="projectList()" x-init="load()">
      <div class="flex justify-between items-center mb-6">
        <h1 class="text-2xl font-bold text-gray-800"><i class="fas fa-folder-open mr-2 text-hm-600"></i>案件一覧</h1>
        <button @click="showCreate = true" class="bg-hm-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-hm-700 transition">
          <i class="fas fa-plus mr-1"></i>新規案件
        </button>
      </div>

      <!-- Filters -->
      <div class="flex gap-2 mb-4">
        <template x-for="s in ['all','draft','in_progress','needs_review','reviewed','archived']">
          <button @click="filter = s === 'all' ? '' : s; load()" 
            :class="(filter === s || (s==='all' && !filter)) ? 'bg-hm-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'"
            class="px-3 py-1.5 rounded-full text-xs font-medium border transition" x-text="s === 'all' ? '全件' : s"></button>
        </template>
      </div>

      <!-- Project List -->
      <div class="bg-white rounded-xl shadow-sm border overflow-hidden">
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">案件コード</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">案件名</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">ラインナップ</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">坪数</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">ステータス</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rev</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">更新日</th>
              <th class="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200">
            <template x-for="p in projects" :key="p.id">
              <tr class="hover:bg-gray-50 cursor-pointer" @click="location.href='/ui/projects/' + p.id">
                <td class="px-4 py-3 text-sm font-mono text-hm-700" x-text="p.project_code"></td>
                <td class="px-4 py-3 text-sm font-medium text-gray-900" x-text="p.project_name"></td>
                <td class="px-4 py-3 text-sm" x-text="p.lineup"></td>
                <td class="px-4 py-3 text-sm" x-text="p.tsubo ? p.tsubo + '坪' : '-'"></td>
                <td class="px-4 py-3"><span class="px-2 py-1 text-xs rounded-full font-medium" 
                  :class="{'bg-gray-100 text-gray-700': p.status==='draft', 'bg-blue-100 text-blue-700': p.status==='in_progress', 'bg-yellow-100 text-yellow-700': p.status==='needs_review', 'bg-green-100 text-green-700': p.status==='reviewed', 'bg-purple-100 text-purple-700': p.status==='archived'}"
                  x-text="p.status"></span></td>
                <td class="px-4 py-3 text-sm text-gray-500" x-text="p.revision_no || 0"></td>
                <td class="px-4 py-3 text-sm text-gray-400" x-text="fmt.date(p.updated_at)"></td>
                <td class="px-4 py-3 text-right">
                  <a :href="'/ui/projects/' + p.id" class="text-hm-600 hover:text-hm-800 text-sm"><i class="fas fa-chevron-right"></i></a>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
        <div x-show="projects.length === 0" class="px-4 py-8 text-center text-gray-400">
          <i class="fas fa-inbox text-3xl mb-2"></i><p>案件がありません</p>
        </div>
      </div>
      <div class="mt-3 text-sm text-gray-500" x-text="meta.total + ' 件中 ' + projects.length + ' 件表示'"></div>

      <!-- Create Modal -->
      <div x-show="showCreate" x-cloak class="fixed inset-0 z-50 flex items-center justify-center bg-black/40" @click.self="showCreate=false">
        <div class="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 fade-in" @click.stop>
          <h2 class="text-lg font-bold mb-4"><i class="fas fa-plus mr-2 text-hm-600"></i>新規案件作成</h2>
          <div class="space-y-3">
            <div class="grid grid-cols-2 gap-3">
              <div><label class="text-xs text-gray-500">案件コード *</label><input x-model="form.project_code" class="w-full border rounded-lg px-3 py-2 text-sm" placeholder="2026-001"></div>
              <div><label class="text-xs text-gray-500">ラインナップ *</label>
                <select x-model="form.lineup" class="w-full border rounded-lg px-3 py-2 text-sm">
                  <option value="SHIN">SHIN</option><option value="RIN">RIN</option>
                  <option value="MOKU_OOYANE">MOKU_OOYANE</option><option value="MOKU_HIRAYA">MOKU_HIRAYA</option>
                  <option value="MOKU_ROKU">MOKU_ROKU</option>
                </select>
              </div>
            </div>
            <div><label class="text-xs text-gray-500">案件名 *</label><input x-model="form.project_name" class="w-full border rounded-lg px-3 py-2 text-sm" placeholder="山田邸新築工事"></div>
            <div><label class="text-xs text-gray-500">顧客名</label><input x-model="form.customer_name" class="w-full border rounded-lg px-3 py-2 text-sm"></div>
            <div class="grid grid-cols-3 gap-3">
              <div><label class="text-xs text-gray-500">坪数</label><input x-model.number="form.tsubo" type="number" class="w-full border rounded-lg px-3 py-2 text-sm"></div>
              <div><label class="text-xs text-gray-500">建築面積(m²)</label><input x-model.number="form.building_area_m2" type="number" class="w-full border rounded-lg px-3 py-2 text-sm"></div>
              <div><label class="text-xs text-gray-500">延床面積(m²)</label><input x-model.number="form.total_floor_area_m2" type="number" class="w-full border rounded-lg px-3 py-2 text-sm"></div>
            </div>
            <div class="grid grid-cols-3 gap-3">
              <div><label class="text-xs text-gray-500">断熱等級</label>
                <select x-model="form.insulation_grade" class="w-full border rounded-lg px-3 py-2 text-sm"><option value="">-</option><option value="5">5</option><option value="6">6</option></select></div>
              <div><label class="text-xs text-gray-500">屋根形状</label>
                <select x-model="form.roof_shape" class="w-full border rounded-lg px-3 py-2 text-sm"><option value="">-</option><option value="kirizuma">切妻</option><option value="yosemune">寄棟</option><option value="katanagare">片流れ</option><option value="flat">フラット</option></select></div>
              <div><label class="text-xs text-gray-500">防火区分</label>
                <select x-model="form.fire_zone_type" class="w-full border rounded-lg px-3 py-2 text-sm"><option value="standard">一般</option><option value="semi_fire">準防火</option><option value="fire">防火</option></select></div>
            </div>
          </div>
          <div class="flex justify-end gap-2 mt-5">
            <button @click="showCreate=false" class="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">キャンセル</button>
            <button @click="create()" class="px-4 py-2 text-sm bg-hm-600 text-white rounded-lg hover:bg-hm-700" :disabled="creating">
              <span x-show="!creating">作成</span><span x-show="creating"><i class="fas fa-spinner fa-spin"></i></span>
            </button>
          </div>
          <div x-show="createError" class="mt-2 text-sm text-red-600" x-text="createError"></div>
        </div>
      </div>
    </div>

    <script>
    function projectList() {
      return {
        projects: [], meta: { total: 0 }, filter: '', showCreate: false, creating: false, createError: '',
        form: { project_code: '', project_name: '', lineup: 'SHIN', customer_name: '', tsubo: null, building_area_m2: null, total_floor_area_m2: null, insulation_grade: '', roof_shape: '', fire_zone_type: 'standard' },
        async load() {
          const q = this.filter ? '?status=' + this.filter : '';
          const res = await api.get('/projects' + q);
          if (res.success) { this.projects = res.data; this.meta = res.meta; }
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
          else { this.createError = res.error || 'Failed'; }
        }
      };
    }
    </script>
  `, 'projects'));
});

// ==========================================================
// /ui/projects/:id — Project Detail + Risk Centre + Tabs
// ==========================================================
uiRoutes.get('/ui/projects/:id', (c) => {
  const id = c.req.param('id');
  return c.html(layout('案件詳細', `
    <div x-data="projectDetail(${id})" x-init="load()">
      <!-- Breadcrumb -->
      <div class="flex items-center text-sm text-gray-500 mb-4">
        <a href="/ui/projects" class="hover:text-hm-600"><i class="fas fa-folder-open mr-1"></i>案件一覧</a>
        <i class="fas fa-chevron-right mx-2 text-xs"></i>
        <span class="text-gray-800 font-medium" x-text="project?.project_name || '...'"></span>
      </div>

      <!-- Project Header -->
      <div class="bg-white rounded-xl shadow-sm border p-5 mb-4" x-show="project">
        <div class="flex justify-between items-start">
          <div>
            <div class="flex items-center gap-3 mb-1">
              <span class="font-mono text-hm-700 text-sm" x-text="project?.project_code"></span>
              <span class="px-2 py-0.5 text-xs rounded-full font-medium"
                :class="{'bg-gray-100 text-gray-700': project?.status==='draft', 'bg-blue-100 text-blue-700': project?.status==='in_progress', 'bg-yellow-100 text-yellow-700': project?.status==='needs_review', 'bg-green-100 text-green-700': project?.status==='reviewed'}"
                x-text="project?.status"></span>
              <span class="text-xs text-gray-400">Rev <span x-text="project?.revision_no || 0"></span></span>
            </div>
            <h1 class="text-xl font-bold text-gray-900" x-text="project?.project_name"></h1>
            <div class="text-sm text-gray-500 mt-1">
              <span x-text="project?.lineup"></span>
              <span x-show="project?.tsubo"> · <span x-text="project?.tsubo"></span>坪</span>
              <span x-show="project?.customer_name"> · <span x-text="project?.customer_name"></span></span>
            </div>
          </div>
          <div class="flex gap-2">
            <button @click="enqueue('initial')" x-show="!project?.current_snapshot_id" class="bg-hm-600 text-white px-3 py-2 rounded-lg text-sm hover:bg-hm-700"><i class="fas fa-calculator mr-1"></i>初期計算</button>
            <button @click="enqueue('regenerate_preserve_reviewed')" x-show="project?.current_snapshot_id" class="bg-blue-600 text-white px-3 py-2 rounded-lg text-sm hover:bg-blue-700"><i class="fas fa-sync mr-1"></i>再計算</button>
          </div>
        </div>
      </div>

      <!-- Tabs -->
      <div class="flex border-b mb-4 bg-white rounded-t-lg">
        <template x-for="t in tabs">
          <button @click="activeTab = t.id" class="px-4 py-3 text-sm font-medium border-b-2 transition"
            :class="activeTab === t.id ? 'border-hm-600 text-hm-700' : 'border-transparent text-gray-500 hover:text-gray-700'"
            x-html="t.icon + ' ' + t.label"></button>
        </template>
      </div>

      <!-- Tab Content: Risk Centre -->
      <div x-show="activeTab === 'risk'" class="fade-in">
        <div x-show="!risk" class="text-center py-8 text-gray-400">読み込み中...</div>
        <div x-show="risk">
          <!-- Risk Summary Cards -->
          <div class="grid grid-cols-4 gap-4 mb-6">
            <div class="bg-white rounded-xl border p-4" :class="'risk-' + risk?.summary?.risk_level">
              <div class="text-xs text-gray-500 mb-1">リスクレベル</div>
              <div class="text-2xl font-bold" :class="{'text-red-600': risk?.summary?.risk_level==='critical', 'text-orange-500': risk?.summary?.risk_level==='high', 'text-yellow-500': risk?.summary?.risk_level==='medium', 'text-green-500': risk?.summary?.risk_level==='low'}" x-text="risk?.summary?.risk_level?.toUpperCase()"></div>
              <div class="text-xs text-gray-400">Score: <span x-text="risk?.summary?.risk_score"></span></div>
            </div>
            <div class="bg-white rounded-xl border p-4">
              <div class="text-xs text-gray-500 mb-1">入力完了率</div>
              <div class="text-2xl font-bold text-gray-800"><span x-text="risk?.input_completion?.overall_rate"></span>%</div>
              <div class="w-full bg-gray-200 rounded-full h-2 mt-2"><div class="bg-hm-500 h-2 rounded-full" :style="'width:' + (risk?.input_completion?.overall_rate || 0) + '%'"></div></div>
            </div>
            <div class="bg-white rounded-xl border p-4">
              <div class="text-xs text-gray-500 mb-1">レビュー進捗</div>
              <div class="text-2xl font-bold text-gray-800"><span x-text="risk?.review_progress?.confirmed || 0"></span><span class="text-sm text-gray-400">/<span x-text="risk?.review_progress?.total_items || 0"></span></span></div>
              <div class="w-full bg-gray-200 rounded-full h-2 mt-2"><div class="bg-blue-500 h-2 rounded-full" :style="'width:' + (risk?.review_progress?.rate || 0) + '%'"></div></div>
            </div>
            <div class="bg-white rounded-xl border p-4">
              <div class="text-xs text-gray-500 mb-1">粗利率</div>
              <div class="text-2xl font-bold" :class="risk?.sales_gap ? (risk.sales_gap.overall_margin_rate >= 25 ? 'text-green-600' : risk.sales_gap.overall_margin_rate >= 15 ? 'text-yellow-600' : 'text-red-600') : 'text-gray-300'">
                <span x-text="risk?.sales_gap ? risk.sales_gap.overall_margin_rate + '%' : '-'"></span>
              </div>
              <div class="text-xs text-gray-400" x-text="risk?.sales_gap ? '期待 ' + risk.sales_gap.expected_margin_rate + '%' : '売価未設定'"></div>
            </div>
          </div>

          <!-- Risk Items -->
          <div class="space-y-3">
            <template x-for="r in risk?.risks || []" :key="r.id">
              <div class="bg-white rounded-lg border p-4 flex items-start gap-3"
                :class="{'border-red-200 bg-red-50/50': r.severity==='error', 'border-yellow-200 bg-yellow-50/50': r.severity==='warning', 'border-blue-200 bg-blue-50/50': r.severity==='info'}">
                <i :class="{'fas fa-exclamation-circle text-red-500': r.severity==='error', 'fas fa-exclamation-triangle text-yellow-500': r.severity==='warning', 'fas fa-info-circle text-blue-400': r.severity==='info'}" class="text-lg mt-0.5"></i>
                <div class="flex-1">
                  <div class="font-medium text-sm text-gray-800" x-text="r.title"></div>
                  <div class="text-xs text-gray-500 mt-0.5" x-text="r.description"></div>
                </div>
                <span x-show="r.action_required" class="px-2 py-1 bg-red-100 text-red-700 text-xs rounded-full">要対応</span>
              </div>
            </template>
          </div>
        </div>
      </div>

      <!-- Tab Content: Cost Items (Trade Detail) -->
      <div x-show="activeTab === 'items'" class="fade-in">
        <div class="bg-white rounded-xl shadow-sm border overflow-hidden">
          <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-3 py-2.5 text-left text-xs font-medium text-gray-500">工種</th>
                <th class="px-3 py-2.5 text-left text-xs font-medium text-gray-500">明細名</th>
                <th class="px-3 py-2.5 text-right text-xs font-medium text-gray-500">自動金額</th>
                <th class="px-3 py-2.5 text-right text-xs font-medium text-gray-500">最終金額</th>
                <th class="px-3 py-2.5 text-center text-xs font-medium text-gray-500">ステータス</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200">
              <template x-for="item in items" :key="item.id">
                <tr class="hover:bg-gray-50 text-sm">
                  <td class="px-3 py-2 text-xs text-gray-500 font-mono" x-text="item.category_code"></td>
                  <td class="px-3 py-2 text-gray-800" x-text="item.item_name"></td>
                  <td class="px-3 py-2 text-right text-gray-500" x-text="fmt.yen(item.auto_amount)"></td>
                  <td class="px-3 py-2 text-right font-medium" :class="item.manual_amount ? 'text-orange-600' : 'text-gray-800'" x-text="fmt.yen(item.final_amount)"></td>
                  <td class="px-3 py-2 text-center">
                    <span class="px-1.5 py-0.5 text-xs rounded" 
                      :class="{'bg-green-100 text-green-700': item.review_status==='confirmed', 'bg-gray-100 text-gray-600': item.review_status==='pending', 'bg-yellow-100 text-yellow-700': item.review_status==='needs_review', 'bg-red-100 text-red-700': item.review_status==='flagged'}"
                      x-text="item.review_status"></span>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
          <div x-show="items.length === 0" class="py-8 text-center text-gray-400">スナップショットを作成してください</div>
        </div>
      </div>

      <!-- Tab Content: Diff Resolution -->
      <div x-show="activeTab === 'diffs'" class="fade-in">
        <div x-show="diffs.length === 0" class="bg-white rounded-xl border p-8 text-center text-gray-400">
          <i class="fas fa-check-circle text-3xl mb-2 text-green-400"></i><p>未解決の差分はありません</p>
        </div>
        <div class="space-y-3">
          <template x-for="d in diffs" :key="d.id">
            <div class="bg-white rounded-lg border p-4" :class="d.is_significant ? 'border-red-200' : ''">
              <div class="flex justify-between items-start">
                <div>
                  <div class="font-medium text-sm" x-text="d.item_name"></div>
                  <div class="text-xs text-gray-500 mt-0.5">
                    <span x-text="d.diff_type"></span> · <span x-text="d.category_code"></span>
                    <span x-show="d.is_significant" class="ml-1 px-1 py-0.5 bg-red-100 text-red-600 rounded text-xs">重要</span>
                  </div>
                  <div class="text-sm mt-1">
                    変動: <span class="font-mono" :class="d.change_amount > 0 ? 'text-red-600' : 'text-green-600'" x-text="fmt.yen(d.change_amount)"></span>
                    (<span x-text="d.change_percent + '%'"></span>)
                  </div>
                </div>
                <div class="flex gap-2" x-show="d.resolution_status === 'pending'">
                  <button @click="resolveDiff(d.id, 'adopt_candidate')" class="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200">採用</button>
                  <button @click="resolveDiff(d.id, 'keep_current')" class="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200">維持</button>
                  <button @click="resolveDiff(d.id, 'dismiss')" class="px-2 py-1 text-xs bg-yellow-100 text-yellow-700 rounded hover:bg-yellow-200">却下</button>
                </div>
                <span x-show="d.resolution_status !== 'pending'" class="px-2 py-1 text-xs rounded-full"
                  :class="{'bg-green-100 text-green-700': d.resolution_status==='adopted', 'bg-gray-100 text-gray-600': d.resolution_status==='kept', 'bg-yellow-100 text-yellow-600': d.resolution_status==='dismissed', 'bg-blue-100 text-blue-700': d.resolution_status==='manual_adjusted'}"
                  x-text="d.resolution_status"></span>
              </div>
            </div>
          </template>
        </div>
      </div>

      <!-- Tab Content: Cost Summary -->
      <div x-show="activeTab === 'summary'" class="fade-in">
        <div class="grid grid-cols-3 gap-4 mb-6">
          <div class="bg-white rounded-xl border p-5 text-center">
            <div class="text-xs text-gray-500 mb-1">原価合計</div>
            <div class="text-2xl font-bold text-gray-800" x-text="fmt.yen(snapshot?.total_cost)"></div>
          </div>
          <div class="bg-white rounded-xl border p-5 text-center">
            <div class="text-xs text-gray-500 mb-1">売価</div>
            <div class="text-2xl font-bold text-gray-800" x-text="fmt.yen(snapshot?.estimated_sale_price)"></div>
          </div>
          <div class="bg-white rounded-xl border p-5 text-center">
            <div class="text-xs text-gray-500 mb-1">粗利率</div>
            <div class="text-2xl font-bold" :class="(snapshot?.overall_margin_rate || 0) >= 25 ? 'text-green-600' : 'text-red-600'" x-text="fmt.pct(snapshot?.overall_margin_rate)"></div>
          </div>
        </div>
        <div class="bg-white rounded-xl shadow-sm border overflow-hidden">
          <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500">カテゴリ</th>
                <th class="px-4 py-3 text-right text-xs font-medium text-gray-500">自動合計</th>
                <th class="px-4 py-3 text-right text-xs font-medium text-gray-500">手動調整</th>
                <th class="px-4 py-3 text-right text-xs font-medium text-gray-500">最終合計</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200">
              <template x-for="s in summaries" :key="s.category_code">
                <tr class="hover:bg-gray-50 text-sm">
                  <td class="px-4 py-3 font-medium" x-text="s.category_code"></td>
                  <td class="px-4 py-3 text-right text-gray-500" x-text="fmt.yen(s.auto_total_amount)"></td>
                  <td class="px-4 py-3 text-right" :class="s.manual_adjustment_amount ? 'text-orange-600' : 'text-gray-400'" x-text="fmt.yen(s.manual_adjustment_amount || 0)"></td>
                  <td class="px-4 py-3 text-right font-medium" x-text="fmt.yen(s.final_total_amount)"></td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Tab Content: Sales Estimate -->
      <div x-show="activeTab === 'sales'" class="fade-in">
        <div class="bg-white rounded-xl border p-5 mb-4">
          <h3 class="font-medium mb-3"><i class="fas fa-yen-sign mr-1 text-hm-600"></i>売価見積もり入力</h3>
          <div class="grid grid-cols-4 gap-3">
            <div><label class="text-xs text-gray-500">種別</label>
              <select x-model="salesForm.estimate_type" class="w-full border rounded-lg px-3 py-2 text-sm">
                <option value="rough">概算</option><option value="internal">社内</option><option value="contract">契約</option><option value="execution">実行</option>
              </select></div>
            <div><label class="text-xs text-gray-500">売価合計</label><input x-model.number="salesForm.total_sale_price" type="number" class="w-full border rounded-lg px-3 py-2 text-sm"></div>
            <div><label class="text-xs text-gray-500">標準売価</label><input x-model.number="salesForm.standard_sale" type="number" class="w-full border rounded-lg px-3 py-2 text-sm"></div>
            <div class="flex items-end"><button @click="createSalesEstimate()" class="w-full bg-hm-600 text-white px-3 py-2 rounded-lg text-sm hover:bg-hm-700">登録</button></div>
          </div>
        </div>
        <div x-show="gap" class="bg-white rounded-xl border p-5 mb-4">
          <h3 class="font-medium mb-3"><i class="fas fa-chart-bar mr-1 text-blue-600"></i>乖離分析</h3>
          <div class="grid grid-cols-4 gap-4">
            <div><div class="text-xs text-gray-500">原価合計</div><div class="font-bold" x-text="fmt.yen(gap?.total_cost)"></div></div>
            <div><div class="text-xs text-gray-500">売価合計</div><div class="font-bold" x-text="fmt.yen(gap?.total_sale_price)"></div></div>
            <div><div class="text-xs text-gray-500">差額</div><div class="font-bold" :class="gap?.gap_amount >= 0 ? 'text-green-600' : 'text-red-600'" x-text="fmt.yen(gap?.gap_amount)"></div></div>
            <div><div class="text-xs text-gray-500">粗利率</div><div class="font-bold" :class="gap?.overall_margin_rate >= 25 ? 'text-green-600' : 'text-red-600'" x-text="fmt.pct(gap?.overall_margin_rate)"></div></div>
          </div>
          <div class="mt-2 text-xs px-2 py-1 rounded inline-block"
            :class="{'bg-green-100 text-green-700': gap?.severity==='ok', 'bg-yellow-100 text-yellow-700': gap?.severity==='warning', 'bg-red-100 text-red-700': gap?.severity==='error'}"
            x-text="gap?.severity?.toUpperCase()"></div>
        </div>
      </div>

      <!-- Toast -->
      <div x-show="toast" x-cloak x-transition class="fixed bottom-4 right-4 bg-gray-800 text-white px-4 py-3 rounded-lg shadow-lg text-sm" x-text="toast"></div>
    </div>

    <script>
    function projectDetail(projectId) {
      return {
        project: null, snapshot: null, items: [], summaries: [], diffs: [], risk: null, gap: null,
        activeTab: 'risk', toast: '',
        salesForm: { estimate_type: 'rough', total_sale_price: 0, standard_sale: 0 },
        tabs: [
          { id: 'risk', label: 'リスクセンター', icon: '<i class="fas fa-shield-alt mr-1"></i>' },
          { id: 'items', label: '工種明細', icon: '<i class="fas fa-list mr-1"></i>' },
          { id: 'diffs', label: '差分解決', icon: '<i class="fas fa-code-compare mr-1"></i>' },
          { id: 'summary', label: '原価サマリ', icon: '<i class="fas fa-chart-pie mr-1"></i>' },
          { id: 'sales', label: '売価見積', icon: '<i class="fas fa-yen-sign mr-1"></i>' },
        ],
        async load() {
          const pRes = await api.get('/projects/' + projectId);
          if (pRes.success) this.project = pRes.data;
          if (this.project?.current_snapshot_id) {
            const sRes = await api.get('/projects/' + projectId + '/snapshots/' + this.project.current_snapshot_id);
            if (sRes.success) { this.snapshot = sRes.data.snapshot; this.items = sRes.data.items || []; this.summaries = sRes.data.summaries || []; }
            const dRes = await api.get('/projects/' + projectId + '/diffs?status=pending');
            if (dRes.success) this.diffs = dRes.data || [];
            const gRes = await api.get('/projects/' + projectId + '/gap-analysis');
            if (gRes.success && gRes.data.has_estimate) this.gap = gRes.data.gap_analysis;
          }
          const rRes = await api.get('/projects/' + projectId + '/risk-centre');
          if (rRes.success) this.risk = rRes.data;
        },
        async enqueue(jobType) {
          const res = await api.post('/projects/' + projectId + '/snapshots/enqueue', { job_type: jobType });
          if (res.success) { this.showToast('計算完了'); await this.load(); }
          else this.showToast('エラー: ' + (res.error || ''));
        },
        async resolveDiff(diffId, action) {
          const res = await api.post('/projects/' + projectId + '/diffs/' + diffId + '/resolve', { action });
          if (res.success) { this.showToast('差分解決: ' + action); await this.load(); }
        },
        async createSalesEstimate() {
          const res = await api.post('/projects/' + projectId + '/sales-estimates', this.salesForm);
          if (res.success) { this.showToast('売価見積もり登録'); this.gap = res.data.gap_analysis; await this.load(); }
          else this.showToast('エラー: ' + (res.error || ''));
        },
        showToast(msg) { this.toast = msg; setTimeout(() => this.toast = '', 3000); },
      };
    }
    </script>
  `, 'projects'));
});

export default uiRoutes;
