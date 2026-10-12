/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useRef, useEffect, MouseEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { 
  FileText, Search, Download, HelpCircle, ArrowUp, ArrowDown, 
  ChevronDown, CheckCircle, AlertCircle, Sparkles, Filter, 
  RefreshCw, BarChart3, TrendingUp, Sliders,
  Shield, Compass, Target, AlertTriangle, Activity,
  Calendar, Trash2, FileSpreadsheet
} from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ComposedChart,
  Bar
} from 'recharts';
import { SQPRow, CompareRow } from '../types';
import { cleanNum, cleanPct, cleanSqpShare, parsePriceStr, getDiagnosis, getTrendInterpretation } from '../utils/analyzers';
import type {SqpMarketplace} from '../sqpReports';

// Common Amazon English catalog stopwords to filter noise
const STOP_WORDS = new Set([
  'for', 'with', 'of', 'and', 'the', 'a', 'to', 'in', 'by', 'on', 'at', 'under', 'or', 'an', 
  'is', 'are', 'from', 'about', 'as', 'into', 'its', 'your', 'my', 'our', 'without'
]);

// Memory-optimized pure math engine for SQP Word Stem aggregation (Market vs ASIN)
const computeSqpStemAnalysis = (
  rows: SQPRow[], 
  stemType: '1-word' | '2-word' | '3-word' | 'all', 
  hideStopWords: boolean, 
  minFreq: number
) => {
  const stemMap = new Map<string, {
    stem: string;
    type: '1-word' | '2-word' | '3-word';
    keywords: string[];
    count: number;
    totalQc: number;
    totalMarketClk: number;
    totalMarketOrd: number;
    totalAsinImp: number;
    totalAsinClk: number;
    totalAsinOrd: number;
  }>();

  rows.forEach(r => {
    const rawKw = r.kw.toLowerCase().trim();
    const words = rawKw
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"']/g, "")
      .split(/\s+/)
      .filter(Boolean);

    // 1-Word Stems Generation
    const singleStems = words.filter(w => !hideStopWords || !STOP_WORDS.has(w));

    // 2-Word Stems (Bi-Grams) Generation
    const doubleStems: string[] = [];
    for (let i = 0; i < words.length - 1; i++) {
      const w1 = words[i];
      const w2 = words[i+1];
      if (hideStopWords && STOP_WORDS.has(w1) && STOP_WORDS.has(w2)) continue;
      doubleStems.push(`${w1} ${w2}`);
    }

    // 3-Word Stems (Tri-Grams) Generation
    const tripleStems: string[] = [];
    for (let i = 0; i < words.length - 2; i++) {
      const w1 = words[i];
      const w2 = words[i+1];
      const w3 = words[i+2];
      if (hideStopWords && STOP_WORDS.has(w1) && STOP_WORDS.has(w2) && STOP_WORDS.has(w3)) continue;
      tripleStems.push(`${w1} ${w2} ${w3}`);
    }

    const stemsToProcess: { val: string; type: '1-word' | '2-word' | '3-word' }[] = [];

    if (stemType === '1-word' || stemType === 'all') {
      const uniqueSingles = Array.from(new Set(singleStems));
      uniqueSingles.forEach(s => stemsToProcess.push({ val: s, type: '1-word' }));
    }
    if (stemType === '2-word' || stemType === 'all') {
      const uniqueDoubles = Array.from(new Set(doubleStems));
      uniqueDoubles.forEach(s => stemsToProcess.push({ val: s, type: '2-word' }));
    }
    if (stemType === '3-word' || stemType === 'all') {
      const uniqueTriples = Array.from(new Set(tripleStems));
      uniqueTriples.forEach(s => stemsToProcess.push({ val: s, type: '3-word' }));
    }

    stemsToProcess.forEach(({ val, type }) => {
      const key = `${type}::${val}`;
      if (!stemMap.has(key)) {
        stemMap.set(key, {
          stem: val,
          type,
          keywords: [r.kw],
          count: 1,
          totalQc: r.qc,
          totalMarketClk: r.tc,
          totalMarketOrd: r.to,
          totalAsinImp: r.imp,
          totalAsinClk: r.clk,
          totalAsinOrd: r.ord
        });
      } else {
        const item = stemMap.get(key)!;
        item.count += 1;
        if (!item.keywords.includes(r.kw)) {
          item.keywords.push(r.kw);
        }
        item.totalQc += r.qc;
        item.totalMarketClk += r.tc;
        item.totalMarketOrd += r.to;
        item.totalAsinImp += r.imp;
        item.totalAsinClk += r.clk;
        item.totalAsinOrd += r.ord;
      }
    });
  });

  const stemList: any[] = [];
  stemMap.forEach(item => {
    if (item.count < minFreq) return;

    const marketCvr = item.totalMarketClk > 0 ? (item.totalMarketOrd / item.totalMarketClk) : 0;
    const asinCvr = item.totalAsinClk > 0 ? (item.totalAsinOrd / item.totalAsinClk) : 0;
    const clickShare = item.totalMarketClk > 0 ? (item.totalAsinClk / item.totalMarketClk) : 0;
    const buyShare = item.totalMarketOrd > 0 ? (item.totalAsinOrd / item.totalMarketOrd) : 0;

    let role = '⚖️ 均衡常规词群';
    let roleClass = 'bg-slate-50 text-slate-655 border border-slate-205';
    let advice = '在此词根下的各项漏斗转化指标与大盘基本持平，状态平稳。建议维持日常观测，跟随市场自然波动即可。';

    if (asinCvr > 1.8 * marketCvr && item.totalAsinOrd >= 3) {
      role = '🟢 强转化核心词根';
      roleClass = 'bg-emerald-50 text-emerald-700 border border-emerald-200';
      advice = '本ASIN在此词根下的转化率远跑赢大盘，具有极强的漏斗承接优势。应全力确保其主流长尾词的排名，防守并扩大点击份额。';
    } else if (buyShare >= 0.12 && item.totalAsinOrd >= 4) {
      role = '👑 黄金市占霸盘词根';
      roleClass = 'bg-purple-50 text-purple-700 border border-purple-200';
      advice = '本ASIN在此词根下抢占了大盘12%以上的订单总量，是绝对的核心支柱。需密切监控竞品动向，守住首屏黄金卡位。';
    } else if (asinCvr < 0.6 * marketCvr && item.totalAsinClk >= 10 && item.totalAsinOrd <= 1) {
      role = '🔴 转化失焦/空耗预警';
      roleClass = 'bg-rose-50 text-rose-700 border border-rose-200';
      advice = '本ASIN在此词根下点击数已产生积累，但转化率大幅逊色于大盘。说明详情页、首图或价格不匹配此词根心智，亟需优化主图等视觉。';
    } else if (marketCvr > 0.07 && buyShare < 0.025 && item.totalQc > 1500 && item.totalAsinOrd === 0) {
      role = '💡 蓝海增量富矿词根';
      roleClass = 'bg-sky-50 text-sky-700 border border-sky-200';
      advice = '大盘在该词根语义下的交易转化率极高，但我们的本ASIN渗透率极低。这是高商业度蓝海空缺，强烈建议通过主图/竞价策略卡位抢流。';
    } else if (item.totalAsinImp > 3000 && item.totalAsinClk < 15 && item.totalAsinClk > 0) {
      role = '⚠️ 点击率瓶颈词根';
      roleClass = 'bg-amber-50 text-amber-700 border border-amber-200';
      advice = '本ASIN在此类词根下获得了可观曝光，但买家不愿点击。说明主图表现力弱、价格过高或评价星级存在劣势，阻碍了流量导入。';
    }

    stemList.push({
      ...item,
      marketCvr,
      asinCvr,
      clickShare,
      buyShare,
      role,
      roleClass,
      advice
    });
  });

  return stemList;
};

const KEYWORD_COLORS = [
  '#2563eb', '#3b82f6', '#1d4ed8', // Blues
  '#8b5cf6', '#a78bfa', '#6d28d9', // Purples
  '#ec4899', '#f43f5e', '#be185d', // Pinks/Roses
  '#ef4444', '#b91c1c',            // Reds
  '#f97316', '#c2410c',            // Oranges
  '#f59e0b', '#b45309',            // Ambers
  '#10b981', '#047857',            // Greens
  '#14b8a6', '#0f766e',            // Teals
  '#06b6d4', '#0e7490'             // Cyans
];

const CustomTrendTooltip = ({ active, payload, label, dimension }: any) => {
  if (active && payload && payload.length) {
    const sortedPayload = [...payload].sort((a: any, b: any) => (b.value || 0) - (a.value || 0));
    
    return (
      <div className="bg-white border border-slate-200 p-3 rounded-lg shadow-md max-h-80 overflow-y-auto font-sans text-[11px] min-w-[200px]">
        <p className="font-bold text-slate-800 border-b border-slate-100 pb-1 mb-1">{label} 对比数据</p>
        <div className="space-y-1">
          {sortedPayload.map((entry: any) => {
            const val = entry.value || 0;
            const formattedVal = dimension === 'conversion'
              ? `${(val * 100).toFixed(2)}%` 
              : val.toLocaleString();
              
            return (
              <div key={entry.name} className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-1.5 truncate max-w-[150px]">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: entry.color }}></span>
                  <span className="text-slate-600 truncate" title={entry.name}>{entry.name}</span>
                </div>
                <span className="font-mono font-bold text-slate-900">{formattedVal}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }
  return null;
};

interface SqpPanelProps {
  sqpRows: SQPRow[];
  setSqpRows: (rows: SQPRow[]) => void;
  compareRows: CompareRow[];
  setCompareRows: (rows: CompareRow[]) => void;
  firstColWidth: number;
  setFirstColWidth: (w: number) => void;
  onDataLoaded: () => void;
  onSaveReport: (file: File, asin: string, marketplace: string, period: string, rows: SQPRow[]) => Promise<void>;
}

export default function SqpPanel({
  sqpRows,
  setSqpRows,
  compareRows,
  setCompareRows,
  firstColWidth,
  setFirstColWidth,
  onDataLoaded,
  onSaveReport,
}: SqpPanelProps) {
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const [compareFile, setCompareFile] = useState<File | null>(null);
  const [currentStatus, setCurrentStatus] = useState<string>('');
  const [marketplace, setMarketplace] = useState<SqpMarketplace>('US');
  const [period, setPeriod] = useState('');
  const [saveBusy, setSaveBusy] = useState(false);
  const [compareStatus, setCompareStatus] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedCluster, setSelectedCluster] = useState<string | null>(null);
  
  // Local parser cache states to avoid Window global extensions
  const [sqpRawCache, setSqpRawCache] = useState<any[]>([]);
  const [compareRawCache, setCompareRawCache] = useState<any[]>([]);

  // Pagination / Load more
  const [sqpLimit, setSqpLimit] = useState(100);
  const [compareLimit, setCompareLimit] = useState(100);

  // Sorting SortState
  const [sqpSort, setSqpSort] = useState<{ key: keyof SQPRow | ''; dir: 'asc' | 'desc' }>({ key: 'buyShare', dir: 'desc' });
  const [compareSort, setCompareSort] = useState<{ key: keyof CompareRow | ''; dir: 'asc' | 'desc' }>({ key: 'qc_change', dir: 'desc' });

  // Word Stem Aggregation states
  const [subTab, setSubTab] = useState<'funnel' | 'stems' | 'annual'>('funnel');
  const [stemType, setStemType] = useState<'1-word' | '2-word' | '3-word' | 'all'>('2-word');
  const [hideStopWords, setHideStopWords] = useState(true);
  const [minFreq, setMinFreq] = useState(1);
  const [stemSearchQuery, setStemSearchQuery] = useState('');
  const [selectedStemRole, setSelectedStemRole] = useState<string | null>(null);
  const [stemSortState, setStemSortState] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'totalQc', dir: 'desc' });
  const [expandedStem, setExpandedStem] = useState<string | null>(null);

  // States for monthly SQP reports (1-12)
  const [monthlySqpData, setMonthlySqpData] = useState<Record<number, { fileName: string; rowCount: number; rows: SQPRow[] }>>({});
  const [monthlyStatus, setMonthlyStatus] = useState<string>('');
  const [selectedAnnualKw, setSelectedAnnualKw] = useState<string>('__TOP20_ASIN__');
  const [annualKwSearch, setAnnualKwSearch] = useState<string>('');
  const [annualTrendDimension, setAnnualTrendDimension] = useState<'search' | 'impression' | 'click' | 'conversion'>('search');
  const [annualTrendSource, setAnnualTrendSource] = useState<'market' | 'asin'>('market');
  const [annualTrendKeywordSet, setAnnualTrendKeywordSet] = useState<'asin' | 'market'>('asin');
  const [hiddenAnnualKeywords, setHiddenAnnualKeywords] = useState<string[]>([]);
  const [annualViewMode, setAnnualViewMode] = useState<'keyword' | 'root'>('keyword');
  const [selectedAnnualRoot, setSelectedAnnualRoot] = useState<string>('');
  const [annualRootSearch, setAnnualRootSearch] = useState<string>('');

  // Helper to detect month from file name
  const detectMonthFromFileName = (fileName: string): number | null => {
    const name = fileName.toLowerCase();
    if (name.includes('十一月') || name.includes('11月')) return 11;
    if (name.includes('十二月') || name.includes('12月')) return 12;
    if (name.includes('一月') || name.includes('1月') || name.includes('01月')) return 1;
    if (name.includes('二月') || name.includes('2月') || name.includes('02月')) return 2;
    if (name.includes('三月') || name.includes('3月') || name.includes('03月')) return 3;
    if (name.includes('四月') || name.includes('4月') || name.includes('04月')) return 4;
    if (name.includes('五月') || name.includes('5月') || name.includes('05月')) return 5;
    if (name.includes('六月') || name.includes('6月') || name.includes('06月')) return 6;
    if (name.includes('七月') || name.includes('7月') || name.includes('07月')) return 7;
    if (name.includes('八月') || name.includes('8月') || name.includes('08月')) return 8;
    if (name.includes('九月') || name.includes('9月') || name.includes('09月')) return 9;
    if (name.includes('十月') || name.includes('10月')) return 10;

    if (name.includes('jan')) return 1;
    if (name.includes('feb')) return 2;
    if (name.includes('mar')) return 3;
    if (name.includes('apr')) return 4;
    if (name.includes('may')) return 5;
    if (name.includes('jun')) return 6;
    if (name.includes('jul')) return 7;
    if (name.includes('aug')) return 8;
    if (name.includes('sep')) return 9;
    if (name.includes('oct')) return 10;
    if (name.includes('nov')) return 11;
    if (name.includes('dec')) return 12;

    const match = name.match(/(?:^|[^0-9])(1[0-2]|[1-9])(?:$|[^0-9])/);
    if (match) {
      const m = parseInt(match[1]);
      if (m >= 1 && m <= 12) return m;
    }
    return null;
  };

  // Helper to extract month from any string cell content
  const detectMonthFromString = (str: string): number | null => {
    const s = str.toLowerCase().trim();
    if (!s) return null;

    // 1. Check for Chinese month names (e.g. "十一月", "11月")
    if (s.includes('十一月') || s.includes('11月') || s.includes('011月')) return 11;
    if (s.includes('十二月') || s.includes('12月') || s.includes('012月')) return 12;
    if (s.includes('一月') || s.includes('1月') || s.includes('01月')) return 1;
    if (s.includes('二月') || s.includes('2月') || s.includes('02月')) return 2;
    if (s.includes('三月') || s.includes('3月') || s.includes('03月')) return 3;
    if (s.includes('四月') || s.includes('4月') || s.includes('04月')) return 4;
    if (s.includes('五月') || s.includes('5月') || s.includes('05月')) return 5;
    if (s.includes('六月') || s.includes('6月') || s.includes('06月')) return 6;
    if (s.includes('七月') || s.includes('7月') || s.includes('07月')) return 7;
    if (s.includes('八月') || s.includes('8月') || s.includes('08月')) return 8;
    if (s.includes('九月') || s.includes('9月') || s.includes('09月')) return 9;
    if (s.includes('十月') || s.includes('10月')) return 10;

    // 2. Check for English month names
    if (s.includes('january') || s.includes('jan')) return 1;
    if (s.includes('february') || s.includes('feb')) return 2;
    if (s.includes('march') || s.includes('mar')) return 3;
    if (s.includes('april') || s.includes('apr')) return 4;
    if (s.includes('may')) return 5;
    if (s.includes('june') || s.includes('jun')) return 6;
    if (s.includes('july') || s.includes('jul')) return 7;
    if (s.includes('august') || s.includes('aug')) return 8;
    if (s.includes('september') || s.includes('sep')) return 9;
    if (s.includes('october') || s.includes('oct')) return 10;
    if (s.includes('november') || s.includes('nov')) return 11;
    if (s.includes('december') || s.includes('dec')) return 12;

    // 3. Match Date formats: YYYY-MM-DD or YYYY/MM/DD or YYYY.MM.DD
    // E.g. "2023-11-01", "2023.11.01", "2023/11/01"
    const ymdMatch = s.match(/\b(19|20)\d\d[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b/);
    if (ymdMatch) {
      return parseInt(ymdMatch[2]);
    }

    // Match: MM/DD/YYYY or DD-MM-YYYY
    const mdyMatch = s.match(/\b(0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])[-/.](19|20)?\d\d\b/);
    if (mdyMatch) {
      return parseInt(mdyMatch[1]);
    }

    // Match: YYYYMMDD (e.g. 20231101)
    const ymdCompactMatch = s.match(/\b(19|20)(\d\d)(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\b/);
    if (ymdCompactMatch) {
      return parseInt(ymdCompactMatch[3]);
    }

    // Match: "2023年11月" or "11/2023"
    const yearMonthMatch = s.match(/\b(19|20)\d\d年(0?[1-9]|1[0-2])月/);
    if (yearMonthMatch) {
      return parseInt(yearMonthMatch[2]);
    }
    const monthYearMatch = s.match(/\b(0?[1-9]|1[0-2])[-/.](19|20)\d\d\b/);
    if (monthYearMatch) {
      return parseInt(monthYearMatch[1]);
    }

    return null;
  };

  // Helper to detect month from the entire rows of spreadsheet
  const detectMonthFromRows = (rows: string[][]): number | null => {
    if (!rows || rows.length === 0) return null;

    // Scan metadata at the top of the file (first 15 rows)
    const scanLimit = Math.min(rows.length, 15);
    for (let i = 0; i < scanLimit; i++) {
      const row = rows[i];
      if (!row) continue;
      for (let j = 0; j < row.length; j++) {
        const cellVal = String(row[j] || '').trim();
        // Prevent matching extremely long texts which aren't metadata
        if (cellVal && cellVal.length < 100) {
          const detected = detectMonthFromString(cellVal);
          if (detected) return detected;
        }
      }
    }

    // Scan the last column (the "last field") of the first 50 rows
    // Often Amazon reports place the reporting period date as the last field of data rows
    const dataRowsLimit = Math.min(rows.length, 50);
    for (let i = 0; i < dataRowsLimit; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;
      // Find the last non-empty cell in the row
      let lastCell = '';
      for (let j = row.length - 1; j >= 0; j--) {
        const val = String(row[j] || '').trim();
        if (val) {
          lastCell = val;
          break;
        }
      }
      if (lastCell && lastCell.length < 60) {
        const detected = detectMonthFromString(lastCell);
        if (detected) return detected;
      }
    }

    // Scan metadata at the bottom of the file (last 15 rows)
    const startFrom = Math.max(0, rows.length - 15);
    for (let i = startFrom; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      for (let j = 0; j < row.length; j++) {
        const cellVal = String(row[j] || '').trim();
        if (cellVal && cellVal.length < 100) {
          const detected = detectMonthFromString(cellVal);
          if (detected) return detected;
        }
      }
    }

    return null;
  };

  // Internal common method to process and store a monthly file's rows
  const processMonthlyRows = (file: File, rows: string[][], month: number) => {
    try {
      if (rows.length < 2) throw new Error('数据空或行数不足');
      let headerIdx = -1;
      for (let i = 0; i < Math.min(rows.length, 12); i++) {
        const rowStr = rows[i].map(c => String(c || '').toLowerCase()).join('||');
        if (
          rowStr.includes('搜索查询') || 
          rowStr.includes('查询') || 
          rowStr.includes('search query') || 
          rowStr.includes('query score') ||
          rowStr.includes('曝光量') ||
          rowStr.includes('点击量') ||
          rowStr.includes('购买量')
        ) {
          headerIdx = i;
          break;
        }
      }
      if (headerIdx === -1) {
        for (let i = 0; i < Math.min(rows.length, 10); i++) {
          if (rows[i] && rows[i].length >= 15) {
            headerIdx = i;
            break;
          }
        }
      }
      if (headerIdx === -1) headerIdx = 0;

      const headers = rows[headerIdx].map(h => String(h || '').trim());
      const colMap = {
        kw: findColIndex(headers, ['搜索查询']),
        qc: findColIndex(headers, ['搜索查询数量']),
        asin: findColIndex(headers, ['asin', '商品']),
        imp: findColIndex(headers, ['曝光量：asin 数量']),
        clk: findColIndex(headers, ['点击量：asin 数量']),
        ord: findColIndex(headers, ['购买量：asin 数量']),
        mp: findColIndex(headers, ['购买量：价格（中位数）']),
        ap: findColIndex(headers, ['购买量：asin 价格（中位数）']),
        tc: findColIndex(headers, ['点击量：总数']),
        to: findColIndex(headers, ['购买量：总数']),
        ti: findColIndex(headers, ['曝光量：总数', '曝光量：总数量']),
        buyShareRaw: findColIndex(headers, ['购买量；购买量：ASIN 占比%', '购买量：asin 占有率', '购买量：asin 占比', '购买量：占有率', '购买量：占比']),
        clickShareRaw: findColIndex(headers, ['点击量：ASIN 占比%', '点击量：asin 占有率', '点击量：asin 占比', '点击量：占有率', '点击量：占比']),
        impShareRaw: findColIndex(headers, ['曝光量：ASIN 占比%', '曝光量：asin 占有率', '曝光量：asin 占比', '曝光量：占有率', '曝光量：占比'])
      };

      if (colMap.kw === -1) colMap.kw = 0;
      if (colMap.qc === -1) colMap.qc = 2;
      if (colMap.ti === -1) colMap.ti = 3;
      if (colMap.imp === -1) colMap.imp = 4;
      if (colMap.impShareRaw === -1) colMap.impShareRaw = 5;
      if (colMap.tc === -1) colMap.tc = 6;
      if (colMap.clk === -1) colMap.clk = 8;
      if (colMap.clickShareRaw === -1) colMap.clickShareRaw = 9;
      if (colMap.to === -1) colMap.to = 24;
      if (colMap.ord === -1) colMap.ord = 26;
      if (colMap.buyShareRaw === -1) colMap.buyShareRaw = 27;
      if (colMap.mp === -1) colMap.mp = 28;
      if (colMap.ap === -1) colMap.ap = 29;

      const parsedRows: any[] = [];
      for (let i = headerIdx + 1; i < rows.length; i++) {
        const r = rows[i];
        if (!r || r.length <= colMap.kw) continue;
        const getSafeVal = (idx: number) => {
          if (idx === -1 || idx >= r.length) return undefined;
          return r[idx];
        };

        const kw = String(getSafeVal(colMap.kw) || '').trim();
        if (!kw) continue;

        parsedRows.push({
          kw,
          qc: colMap.qc !== -1 ? cleanNum(getSafeVal(colMap.qc)) : 0,
          asin: colMap.asin !== -1 ? String(getSafeVal(colMap.asin) || '').trim() : '未标注',
          imp: cleanNum(getSafeVal(colMap.imp)),
          clk: cleanNum(getSafeVal(colMap.clk)),
          ord: cleanNum(getSafeVal(colMap.ord)),
          mp: colMap.mp !== -1 ? String(getSafeVal(colMap.mp) || '-').trim() : '-',
          ap: colMap.ap !== -1 ? String(getSafeVal(colMap.ap) || '-').trim() : '-',
          tc: colMap.tc !== -1 ? cleanNum(getSafeVal(colMap.tc)) : 0,
          to: colMap.to !== -1 ? cleanNum(getSafeVal(colMap.to)) : 0,
          ti: colMap.ti !== -1 ? cleanNum(getSafeVal(colMap.ti)) : 0,
          buyShareRaw: colMap.buyShareRaw !== -1 ? cleanSqpShare(getSafeVal(colMap.buyShareRaw)) : 0,
          clickShareRaw: colMap.clickShareRaw !== -1 ? cleanSqpShare(getSafeVal(colMap.clickShareRaw)) : 0,
          impShareRaw: colMap.impShareRaw !== -1 ? cleanSqpShare(getSafeVal(colMap.impShareRaw)) : 0,
        });
      }

      const validRows = parsedRows.filter(r => r.imp > 0 || r.clk > 0 || r.ord > 0);
      
      const gI = validRows.reduce((sum, r) => sum + r.imp, 0);
      const gC = validRows.reduce((sum, r) => sum + r.clk, 0);
      const gO = validRows.reduce((sum, r) => sum + r.ord, 0);

      const processed: SQPRow[] = validRows.map(r => {
        const mc = r.tc > 0 ? r.to / r.tc : 0;
        const ac = r.clk > 0 ? r.ord / r.clk : 0;
        let bs = r.buyShareRaw > 0 ? r.buyShareRaw : (r.to > 0 ? r.ord / r.to : 0);
        let cs = r.clickShareRaw > 0 ? r.clickShareRaw : (r.tc > 0 ? r.clk / r.tc : 0);
        let ims = r.impShareRaw > 0 ? r.impShareRaw : (r.ti > 0 ? r.imp / r.ti : 0);
        
        if (bs === 0 && r.to === 0 && gO > 0) bs = r.ord / gO;
        if (cs === 0 && r.tc === 0 && gC > 0) cs = r.clk / gC;
        if (ims === 0 && r.ti === 0 && gI > 0) ims = r.imp / gI;

        const clickImpRatio = ims > 0 ? cs / ims : 0;
        const buyClickRatio = cs > 0 ? bs / cs : 0;
        const mCtr = r.ti > 0 ? r.tc / r.ti : (ims > 0 && cs > 0 && r.imp > 0 ? (r.clk / cs) / (r.imp / ims) : 0);
        const aCtr = r.imp > 0 ? r.clk / r.imp : 0;
        
        return {
          ...r,
          buyShare: bs,
          clickShare: cs,
          impShare: ims,
          marketCVR: mc,
          asinCVR: ac,
          marketCTR: mCtr,
          asinCTR: aCtr,
          clickImpRatio,
          buyClickRatio,
          convTag: '',
          convClass: '',
          advice: '',
          adviceColor: '',
          marketPrice: parsePriceStr(r.mp),
          asinPrice: parsePriceStr(r.ap)
        };
      });

      setMonthlySqpData(prev => ({
        ...prev,
        [month]: {
          fileName: file.name,
          rowCount: processed.length,
          rows: processed
        }
      }));
      setMonthlyStatus(prev => `✅ 成功解析 ${month}月份 数据（${processed.length}行）`);
    } catch (err: any) {
      setMonthlyStatus(`❌ ${month}月份 解析错误：${err.message}`);
    }
  };

  const parseMonthlyFile = (file: File, month: number) => {
    setMonthlyStatus(`⏳ 正在解析 ${month}月份 数据...`);
    parseFileToRows(
      file,
      (rows) => {
        processMonthlyRows(file, rows, month);
      },
      (err) => {
        setMonthlyStatus(`❌ ${month}月份 读取错误：${err.message}`);
      }
    );
  };

  const handleBatchMonthlyUpload = (files: FileList) => {
    setMonthlyStatus(`⏳ 正在批量处理 ${files.length} 个文件...`);
    let count = 0;
    
    Array.from(files).forEach(file => {
      parseFileToRows(
        file,
        (rows) => {
          // Detect month from filename or from the last field / metadata of the rows
          let month = detectMonthFromFileName(file.name);
          if (!month) {
            month = detectMonthFromRows(rows);
          }
          
          if (month && month >= 1 && month <= 12) {
            processMonthlyRows(file, rows, month);
            count++;
            setMonthlyStatus(`⏳ 正在处理批量文件: 已成功匹配并解析 ${count} 个文件...`);
          } else {
            // Find first empty slot
            let emptyMonth = null;
            for (let m = 1; m <= 12; m++) {
              if (!monthlySqpData[m] && !Array.from(files).some(f => {
                const fMonth = detectMonthFromFileName(f.name);
                return fMonth === m && f !== file;
              })) {
                emptyMonth = m;
                break;
              }
            }
            if (emptyMonth) {
              processMonthlyRows(file, rows, emptyMonth);
              count++;
              setMonthlyStatus(`⏳ 正在处理批量文件: 已匹配并解析 ${count} 个文件 (分配空槽位 ${emptyMonth}月)...`);
            } else {
              setMonthlyStatus(prev => prev + `\n❌ 无法自动识别文件 "${file.name}" 的月份，且无空闲槽位。`);
            }
          }
        },
        (err) => {
          setMonthlyStatus(prev => prev + `\n❌ 读取文件 "${file.name}" 失败: ${err.message}`);
        }
      );
    });
  };

  const allMonthlyKeywords = useMemo(() => {
    const kws = new Set<string>();
    Object.values(monthlySqpData).forEach((data: any) => {
      if (data && data.rows) {
        data.rows.forEach((r: SQPRow) => kws.add(r.kw));
      }
    });
    return Array.from(kws).sort();
  }, [monthlySqpData]);

  const filteredAnnualKws = useMemo(() => {
    if (!annualKwSearch) return allMonthlyKeywords;
    const q = annualKwSearch.toLowerCase().trim();
    return allMonthlyKeywords.filter(k => k.toLowerCase().includes(q));
  }, [allMonthlyKeywords, annualKwSearch]);

  const topAnnualKeywords = useMemo(() => {
    const kwMap = new Map<string, { kw: string; totalAsinOrd: number; totalMarketOrd: number; totalQc: number }>();
    Object.values(monthlySqpData).forEach((data: any) => {
      if (data && data.rows) {
        data.rows.forEach((r: SQPRow) => {
          const key = r.kw;
          if (!kwMap.has(key)) {
            kwMap.set(key, {
              kw: r.kw,
              totalAsinOrd: r.ord || 0,
              totalMarketOrd: r.to || 0,
              totalQc: r.qc || 0
            });
          } else {
            const item = kwMap.get(key)!;
            item.totalAsinOrd += r.ord || 0;
            item.totalMarketOrd += r.to || 0;
            item.totalQc += r.qc || 0;
          }
        });
      }
    });

    const items = Array.from(kwMap.values());
    const sortedByAsin = [...items].sort((a, b) => b.totalAsinOrd - a.totalAsinOrd || b.totalMarketOrd - a.totalMarketOrd);
    const sortedByMarket = [...items].sort((a, b) => b.totalMarketOrd - a.totalMarketOrd || b.totalQc - a.totalQc);

    return {
      byAsin: sortedByAsin.slice(0, 20),
      byMarket: sortedByMarket.slice(0, 20)
    };
  }, [monthlySqpData]);

  const annualTopRoots = useMemo(() => {
    const rootMap = new Map<string, {
      root: string;
      kwCount: number;
      totalQc: number;
      totalAsinOrd: number;
      totalMarketOrd: number;
      matchingKws: string[];
    }>();

    const stopWords = new Set([
      'for', 'in', 'on', 'the', 'a', 'an', 'with', 'and', 'of', 'to', 'is', 'are', 'at', 'by', 'from', 'up', 'as', 'it', 'or', 'be', 'do', 'get', 'set', 'can', 'will', 'if', 'all', 'not', 'no', 'yes', 'we', 'you', 'my', 'your', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0'
    ]);

    const seenKwRootPairs = new Set<string>();

    Object.values(monthlySqpData).forEach((mData: any) => {
      if (!mData || !mData.rows) return;
      mData.rows.forEach((row: SQPRow) => {
        const cleanKw = row.kw.toLowerCase().trim();
        const tokens = cleanKw
          .replace(/[^\w\u4e00-\u9fa5\s]/g, ' ')
          .split(/\s+/)
          .filter(t => t.length >= 2 && !stopWords.has(t) && !/^\d+$/.test(t));
        
        const uniqueTokens = Array.from(new Set(tokens));
        uniqueTokens.forEach(token => {
          let entry = rootMap.get(token);
          if (!entry) {
            entry = {
              root: token,
              kwCount: 0,
              totalQc: 0,
              totalAsinOrd: 0,
              totalMarketOrd: 0,
              matchingKws: []
            };
            rootMap.set(token, entry);
          }
          entry.totalQc += (row.qc || 0);
          entry.totalAsinOrd += (row.ord || 0);
          entry.totalMarketOrd += (row.to || 0);

          const pairKey = `${token}:::${cleanKw}`;
          if (!seenKwRootPairs.has(pairKey)) {
            seenKwRootPairs.add(pairKey);
            entry.kwCount++;
            entry.matchingKws.push(row.kw);
          }
        });
      });
    });

    return Array.from(rootMap.values()).sort((a, b) => b.totalQc - a.totalQc);
  }, [monthlySqpData]);

  const activeRootMatchingKws = useMemo(() => {
    const rootWord = selectedAnnualRoot || (annualTopRoots[0]?.root || '');
    if (!rootWord) return [];
    const q = rootWord.toLowerCase().trim();
    if (!q) return [];
    const map = new Map<string, { kw: string; totalQc: number; totalAsinOrd: number; totalMarketOrd: number; avgCvr: number; count: number }>();
    Object.values(monthlySqpData).forEach((mData: any) => {
      if (!mData || !mData.rows) return;
      mData.rows.forEach((row: SQPRow) => {
        if (row.kw.toLowerCase().includes(q)) {
          let item = map.get(row.kw);
          if (!item) {
            item = { kw: row.kw, totalQc: 0, totalAsinOrd: 0, totalMarketOrd: 0, avgCvr: 0, count: 0 };
            map.set(row.kw, item);
          }
          item.totalQc += (row.qc || 0);
          item.totalAsinOrd += (row.ord || 0);
          item.totalMarketOrd += (row.to || 0);
          item.avgCvr += (row.asinCVR || 0);
          item.count++;
        }
      });
    });
    return Array.from(map.values()).map(x => ({
      ...x,
      avgCvr: x.count > 0 ? x.avgCvr / x.count : 0
    })).sort((a, b) => b.totalQc - a.totalQc);
  }, [monthlySqpData, selectedAnnualRoot, annualTopRoots]);

  const selectedTopKeywords = useMemo(() => {
    return annualTrendKeywordSet === 'asin' 
      ? topAnnualKeywords.byAsin 
      : topAnnualKeywords.byMarket;
  }, [topAnnualKeywords, annualTrendKeywordSet]);

  const keywordChartData = useMemo(() => {
    const data: any[] = [];
    for (let m = 1; m <= 12; m++) {
      const monthData = monthlySqpData[m];
      const entry: any = { 
        month: `${m}月`, 
        hasData: !!monthData 
      };
      
      selectedTopKeywords.forEach(({ kw }) => {
        if (!monthData) {
          entry[kw] = 0;
        } else {
          const row = monthData.rows.find(r => r.kw.toLowerCase() === kw.toLowerCase());
          if (row) {
            if (annualTrendDimension === 'search') {
              entry[kw] = annualTrendSource === 'market' ? (row.qc || 0) : (row.ord || 0);
            } else if (annualTrendDimension === 'impression') {
              entry[kw] = annualTrendSource === 'market' 
                ? (row.ti || (row.impShare > 0 ? Math.round(row.imp / row.impShare) : 0)) 
                : (row.imp || 0);
            } else if (annualTrendDimension === 'click') {
              entry[kw] = annualTrendSource === 'market' 
                ? (row.tc || (row.clickShare > 0 ? Math.round(row.clk / row.clickShare) : 0)) 
                : (row.clk || 0);
            } else if (annualTrendDimension === 'conversion') {
              entry[kw] = annualTrendSource === 'market' ? (row.marketCVR || 0) : (row.asinCVR || 0);
            }
          } else {
            entry[kw] = 0;
          }
        }
      });
      data.push(entry);
    }
    return data;
  }, [monthlySqpData, selectedTopKeywords, annualTrendDimension, annualTrendSource]);

  const downloadTrendData = () => {
    const keywords = selectedTopKeywords;
    if (keywords.length === 0) {
      alert("请先上传月度 SQP 数据包以生成趋势数据！");
      return;
    }

    let csvContent = "\ufeff"; // UTF-8 BOM for Excel
    // Headers
    csvContent += "关键词,分析指标,1月,2月,3月,4月,5月,6月,7月,8月,9月,10月,11月,12月,全年总计/均值\n";

    // First export Top 20 Total rows (前20个关键词总的大盘搜索量, CVR, 本品CVR, 本品购买占比)
    const top20Metrics = [
      { name: "大盘搜索量 (Top20 QC)", key: "marketQc", isPct: false },
      { name: "大盘转化率 (Top20 Market CVR)", key: "marketCVR", isPct: true },
      { name: "本品转化率 (Top20 ASIN CVR)", key: "asinCVR", isPct: true },
      { name: "本品购买占比 (Top20 Buy Share)", key: "buyShare", isPct: true }
    ];

    top20Metrics.forEach(m => {
      let rowStr = `"【前20词总汇总】",${m.name}`;
      let total = 0;
      let count = 0;
      for (let monthNum = 1; monthNum <= 12; monthNum++) {
        const item = annualChartData[monthNum - 1];
        if (!item || !item.hasData) {
          rowStr += ",-";
        } else {
          const val = item[m.key] || 0;
          total += val;
          count++;
          rowStr += `,${m.isPct ? (val * 100).toFixed(4) + "%" : val}`;
        }
      }
      let summaryStr = "";
      if (m.isPct) {
        summaryStr = count > 0 ? (total / count * 100).toFixed(4) + "%" : "-";
      } else {
        summaryStr = total.toString();
      }
      rowStr += `,${summaryStr}\n`;
      csvContent += rowStr;
    });

    keywords.forEach(({ kw }) => {
      // Export all 4 dimensions for both Market and ASIN
      const metrics = [
        { name: "大盘搜索量 (Market Search QC)", key: "qc", isPct: false, isDerived: false },
        { name: "本品购买量 (ASIN Orders)", key: "ord", isPct: false, isDerived: false },
        { name: "大盘总展示量 (Market Impressions)", key: "marketImp", isPct: false, isDerived: true },
        { name: "本品展示量 (ASIN Impressions)", key: "imp", isPct: false, isDerived: false },
        { name: "大盘总点击量 (Market Clicks)", key: "marketClk", isPct: false, isDerived: true },
        { name: "本品点击量 (ASIN Clicks)", key: "clk", isPct: false, isDerived: false },
        { name: "大盘转化率 (Market CVR)", key: "marketCVR", isPct: true, isDerived: false },
        { name: "本品转化率 (ASIN CVR)", key: "asinCVR", isPct: true, isDerived: false },
      ];

      metrics.forEach(m => {
        let rowStr = `"${kw.replace(/"/g, '""')}",${m.name}`;
        let total = 0;
        let count = 0;
        
        for (let monthNum = 1; monthNum <= 12; monthNum++) {
          const monthData = monthlySqpData[monthNum];
          if (!monthData) {
            rowStr += ",-";
          } else {
            const row = monthData.rows.find(r => r.kw.toLowerCase() === kw.toLowerCase());
            if (row) {
              let val = 0;
              if (m.isDerived) {
                if (m.key === "marketImp") {
                  val = row.ti || (row.impShare > 0 ? Math.round(row.imp / row.impShare) : 0);
                } else if (m.key === "marketClk") {
                  val = row.tc || (row.clickShare > 0 ? Math.round(row.clk / row.clickShare) : 0);
                }
              } else {
                val = row[m.key as keyof SQPRow] as number || 0;
              }
              total += val;
              count++;
              rowStr += `,${m.isPct ? (val * 100).toFixed(4) + "%" : val}`;
            } else {
              rowStr += ",0";
              count++;
            }
          }
        }

        // Add summary
        let summaryStr = "";
        if (m.isPct) {
          summaryStr = count > 0 ? (total / count * 100).toFixed(4) + "%" : "-";
        } else {
          summaryStr = total.toString();
        }
        rowStr += `,${summaryStr}\n`;
        csvContent += rowStr;
      });
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `SQP_Top20_Annual_Trend_${annualTrendKeywordSet}_keywords.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadRootTrendData = () => {
    const rootWord = selectedAnnualRoot || (annualTopRoots[0]?.root || '');
    if (!rootWord) {
      alert("请先选择或输入词根！");
      return;
    }

    let csvContent = "\ufeff"; // UTF-8 BOM for Excel
    csvContent += "词汇名称,分析指标,1月,2月,3月,4月,5月,6月,7月,8月,9月,10月,11月,12月,全年总计/均值\n";

    const rootMetrics = [
      { name: "大盘搜索量 (Root QC)", key: "marketQc", isPct: false },
      { name: "大盘转化率 (Root Market CVR)", key: "marketCVR", isPct: true },
      { name: "本品转化率 (Root ASIN CVR)", key: "asinCVR", isPct: true },
      { name: "本品购买占比 (Root Buy Share)", key: "buyShare", isPct: true },
      { name: "包含关键词数 (Keyword Count)", key: "kwCount", isPct: false }
    ];

    rootMetrics.forEach(m => {
      let rowStr = `"【词根汇总：${rootWord}】",${m.name}`;
      let total = 0;
      let count = 0;
      for (let monthNum = 1; monthNum <= 12; monthNum++) {
        const item = annualChartData[monthNum - 1];
        if (!item || !item.hasData) {
          rowStr += ",-";
        } else {
          const val = item[m.key] || 0;
          total += val;
          count++;
          rowStr += `,${m.isPct ? (val * 100).toFixed(4) + "%" : val}`;
        }
      }
      let summaryStr = "";
      if (m.isPct) {
        summaryStr = count > 0 ? (total / count * 100).toFixed(4) + "%" : "-";
      } else {
        summaryStr = m.key === "kwCount" ? (count > 0 ? Math.round(total / count).toString() : "0") : total.toString();
      }
      rowStr += `,${summaryStr}\n`;
      csvContent += rowStr;
    });

    // Also export each keyword containing this root word
    activeRootMatchingKws.slice(0, 50).forEach(({ kw }) => {
      const metrics = [
        { name: "大盘搜索量 (Market QC)", key: "qc", isPct: false },
        { name: "大盘 CVR (Market CVR)", key: "marketCVR", isPct: true },
        { name: "本品 CVR (ASIN CVR)", key: "asinCVR", isPct: true },
        { name: "本品购买占比 (Buy Share)", key: "buyShare", isPct: true }
      ];

      metrics.forEach(m => {
        let rowStr = `"${kw.replace(/"/g, '""')}",${m.name}`;
        let total = 0;
        let count = 0;
        for (let monthNum = 1; monthNum <= 12; monthNum++) {
          const monthData = monthlySqpData[monthNum];
          if (!monthData) {
            rowStr += ",-";
          } else {
            const row = monthData.rows.find(r => r.kw.toLowerCase() === kw.toLowerCase());
            if (row) {
              const val = Number(row[m.key as keyof SQPRow]) || 0;
              total += val;
              count++;
              rowStr += `,${m.isPct ? (val * 100).toFixed(4) + "%" : val}`;
            } else {
              rowStr += ",0";
              count++;
            }
          }
        }
        let summaryStr = "";
        if (m.isPct) {
          summaryStr = count > 0 ? (total / count * 100).toFixed(4) + "%" : "-";
        } else {
          summaryStr = total.toString();
        }
        rowStr += `,${summaryStr}\n`;
        csvContent += rowStr;
      });
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `SQP_Root_Trend_${rootWord}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const annualChartData = useMemo(() => {
    const data: any[] = [];
    for (let m = 1; m <= 12; m++) {
      const monthData = monthlySqpData[m];
      if (!monthData) {
        data.push({
          month: `${m}月`,
          hasData: false,
          kwCount: 0,
          marketQc: 0,
          asinImp: 0,
          asinClk: 0,
          asinOrd: 0,
          marketCVR: 0,
          asinCVR: 0,
          buyShare: 0
        });
        continue;
      }

      if (annualViewMode === 'root') {
        const rootQuery = (selectedAnnualRoot || (annualTopRoots[0]?.root || '')).toLowerCase().trim();
        const targetRows = rootQuery
          ? monthData.rows.filter(r => r.kw.toLowerCase().includes(rootQuery))
          : monthData.rows;

        const totalQc = targetRows.reduce((sum, r) => sum + r.qc, 0);
        const totalImp = targetRows.reduce((sum, r) => sum + r.imp, 0);
        const totalClk = targetRows.reduce((sum, r) => sum + r.clk, 0);
        const totalOrd = targetRows.reduce((sum, r) => sum + r.ord, 0);
        const totalTc = targetRows.reduce((sum, r) => sum + r.tc, 0);
        const totalTo = targetRows.reduce((sum, r) => sum + r.to, 0);

        const marketCVR = totalTc > 0
          ? (totalTo / totalTc)
          : (targetRows.length > 0 ? targetRows.reduce((sum, r) => sum + (r.marketCVR || 0), 0) / targetRows.length : 0);
        const asinCVR = totalClk > 0
          ? (totalOrd / totalClk)
          : (targetRows.length > 0 ? targetRows.reduce((sum, r) => sum + (r.asinCVR || 0), 0) / targetRows.length : 0);
        const buyShare = totalTo > 0
          ? (totalOrd / totalTo)
          : (targetRows.length > 0 ? targetRows.reduce((sum, r) => sum + (r.buyShare || 0), 0) / targetRows.length : 0);

        data.push({
          month: `${m}月`,
          hasData: true,
          kwCount: targetRows.length,
          marketQc: totalQc,
          asinImp: totalImp,
          asinClk: totalClk,
          asinOrd: totalOrd,
          marketCVR,
          asinCVR,
          buyShare
        });
      } else if (selectedAnnualKw === '__ALL__' || selectedAnnualKw === '__TOP20_ASIN__' || selectedAnnualKw === '__TOP20_MARKET__') {
        let targetRows = monthData.rows;
        if (selectedAnnualKw === '__TOP20_ASIN__') {
          const top20Set = new Set(topAnnualKeywords.byAsin.map(item => item.kw.toLowerCase()));
          targetRows = monthData.rows.filter(r => top20Set.has(r.kw.toLowerCase()));
        } else if (selectedAnnualKw === '__TOP20_MARKET__') {
          const top20Set = new Set(topAnnualKeywords.byMarket.map(item => item.kw.toLowerCase()));
          targetRows = monthData.rows.filter(r => top20Set.has(r.kw.toLowerCase()));
        }

        const totalQc = targetRows.reduce((sum, r) => sum + r.qc, 0);
        const totalImp = targetRows.reduce((sum, r) => sum + r.imp, 0);
        const totalClk = targetRows.reduce((sum, r) => sum + r.clk, 0);
        const totalOrd = targetRows.reduce((sum, r) => sum + r.ord, 0);
        const totalTc = targetRows.reduce((sum, r) => sum + r.tc, 0);
        const totalTo = targetRows.reduce((sum, r) => sum + r.to, 0);

        const marketCVR = totalTc > 0
          ? (totalTo / totalTc)
          : (targetRows.length > 0 ? targetRows.reduce((sum, r) => sum + (r.marketCVR || 0), 0) / targetRows.length : 0);
        const asinCVR = totalClk > 0
          ? (totalOrd / totalClk)
          : (targetRows.length > 0 ? targetRows.reduce((sum, r) => sum + (r.asinCVR || 0), 0) / targetRows.length : 0);
        const buyShare = totalTo > 0
          ? (totalOrd / totalTo)
          : (targetRows.length > 0 ? targetRows.reduce((sum, r) => sum + (r.buyShare || 0), 0) / targetRows.length : 0);

        data.push({
          month: `${m}月`,
          hasData: true,
          kwCount: targetRows.length,
          marketQc: totalQc,
          asinImp: totalImp,
          asinClk: totalClk,
          asinOrd: totalOrd,
          marketCVR,
          asinCVR,
          buyShare
        });
      } else {
        const row = monthData.rows.find(r => r.kw.toLowerCase() === selectedAnnualKw.toLowerCase());
        if (row) {
          data.push({
            month: `${m}月`,
            hasData: true,
            kwCount: 1,
            marketQc: row.qc,
            asinImp: row.imp,
            asinClk: row.clk,
            asinOrd: row.ord,
            marketCVR: row.marketCVR,
            asinCVR: row.asinCVR,
            buyShare: row.buyShare
          });
        } else {
          data.push({
            month: `${m}月`,
            hasData: true,
            kwCount: 0,
            marketQc: 0,
            asinImp: 0,
            asinClk: 0,
            asinOrd: 0,
            marketCVR: 0,
            asinCVR: 0,
            buyShare: 0
          });
        }
      }
    }
    return data;
  }, [monthlySqpData, selectedAnnualKw, topAnnualKeywords, annualViewMode, selectedAnnualRoot, annualTopRoots]);

  // Resize column ref & event
  const isResizing = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(firstColWidth);

  const stats = useMemo(() => {
    if (sqpRows.length === 0) return { totalImp: 0, totalClk: 0, totalOrd: 0, avgCVR: 0, highPerformanceCount: 0 };
    const totalImp = sqpRows.reduce((a, b) => a + b.imp, 0);
    const totalClk = sqpRows.reduce((a, b) => a + b.clk, 0);
    const totalOrd = sqpRows.reduce((a, b) => a + b.ord, 0);
    const cOverC = totalClk > 0 ? (totalOrd / totalClk) : 0;
    const highPerformanceCount = sqpRows.filter(r => r.convTag === '🟢 承接力碾压').length;
    return { totalImp, totalClk, totalOrd, avgCVR: cOverC, highPerformanceCount };
  }, [sqpRows]);

  const clusterStats = useMemo(() => {
    const categories = {
      defense: {
        name: '品牌防御',
        key: 'defense',
        description: '高流量力 (Ci ≥ 1.0) 且高转化力 (Bi ≥ 1.0)。核心防御保护带（通常为高优势品牌或核心心智词），建议主力守护排位。',
        color: 'border-purple-200 bg-purple-50/20 text-purple-950',
        borderColor: 'border-purple-100',
        hoverColor: 'hover:bg-purple-50/40 hover:border-purple-300',
        activeClass: 'ring-2 ring-purple-550/20 shadow-lg border-purple-500 bg-purple-50/70 font-bold text-purple-950',
        badgeColor: 'bg-purple-100 text-purple-800 border-purple-200',
        emoji: '🛡️',
        items: [] as SQPRow[]
      },
      harvest: {
        name: '高转化收割',
        key: 'harvest',
        description: '低流量力 (Ci < 1.0) 但高转化力 (Bi ≥ 1.0)。高转化黄金长尾，点击吸引较弱但转化扎实，应大力溢价推高流量。',
        color: 'border-emerald-200 bg-emerald-50/20 text-emerald-950',
        borderColor: 'border-emerald-100',
        hoverColor: 'hover:bg-emerald-50/40 hover:border-emerald-300',
        activeClass: 'ring-2 ring-emerald-550/20 shadow-lg border-emerald-500 bg-emerald-50/70 font-bold text-emerald-950',
        badgeColor: 'bg-emerald-100 text-emerald-800 border-emerald-200',
        emoji: '🎯',
        items: [] as SQPRow[]
      },
      exploration: {
        name: '拓荒流量',
        key: 'exploration',
        description: '高流量力 (Ci ≥ 1.0) 但低转化力 (Bi < 1.0)。高点击广撒网流量（常为类别大词），流失偏高，宜通过促销/主图优化拉升。',
        color: 'border-blue-200 bg-blue-50/20 text-blue-955',
        borderColor: 'border-blue-100',
        hoverColor: 'hover:bg-blue-50/40 hover:border-blue-300',
        activeClass: 'ring-2 ring-blue-550/20 shadow-lg border-blue-500 bg-blue-55/40 font-bold text-blue-955',
        badgeColor: 'bg-blue-100 text-blue-900 border-blue-200',
        emoji: '🧭',
        items: [] as SQPRow[]
      },
      idling: {
        name: '无效空转',
        key: 'idling',
        description: '低流量力 (Ci < 1.0) 且低转化力 (Bi < 1.0)。双端低迷词包，引流与变现均缺乏效率，易产生无效空耗，宜核减出价或否定。',
        color: 'border-red-200 bg-red-50/20 text-red-950',
        borderColor: 'border-red-100',
        hoverColor: 'hover:bg-red-50/40 hover:border-red-300',
        activeClass: 'ring-2 ring-red-550/20 shadow-lg border-red-500 bg-red-50/70 font-bold text-red-950',
        badgeColor: 'bg-red-100 text-red-850 border-red-200',
        emoji: '💨',
        items: [] as SQPRow[]
      },
    };

    sqpRows.forEach(r => {
      const bi = r.buyClickRatio;
      const ci = r.clickImpRatio;
      if (ci >= 1.0 && bi >= 1.0) {
        categories.defense.items.push(r);
      } else if (ci < 1.0 && bi >= 1.0) {
        categories.harvest.items.push(r);
      } else if (ci >= 1.0 && bi < 1.0) {
        categories.exploration.items.push(r);
      } else {
        categories.idling.items.push(r);
      }
    });

    const totalCount = sqpRows.length;

    return Object.values(categories).map(cat => {
      const count = cat.items.length;
      const pct = totalCount > 0 ? (count / totalCount) * 100 : 0;
      const totalQc = cat.items.reduce((sum, item) => sum + item.qc, 0);
      const totalClk = cat.items.reduce((sum, item) => sum + item.clk, 0);
      const totalOrd = cat.items.reduce((sum, item) => sum + item.ord, 0);
      
      const avgBi = count > 0 ? cat.items.reduce((sum, item) => sum + item.buyClickRatio, 0) / count : 0;
      const avgCi = count > 0 ? cat.items.reduce((sum, item) => sum + item.clickImpRatio, 0) / count : 0;
      const clusterCVR = totalClk > 0 ? (totalOrd / totalClk) : 0;

      return {
        ...cat,
        count,
        pct,
        totalQc,
        totalClk,
        totalOrd,
        avgBi,
        avgCi,
        clusterCVR
      };
    });
  }, [sqpRows]);

  const handleStartResize = (e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    startX.current = e.clientX;
    startWidth.current = firstColWidth;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isResizing.current) return;
    const offset = e.clientX - startX.current;
    const newWidth = Math.max(100, Math.min(350, startWidth.current + offset));
    setFirstColWidth(newWidth);
  };

  const handleMouseUp = () => {
    isResizing.current = false;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  };

  const normalizeHeader = (str: string): string => {
    return String(str || '')
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/：/g, ':')
      .replace(/；/g, ';')
      .replace(/％/g, '%')
      .replace(/（/g, '(')
      .replace(/）/g, ')');
  };

  const findColIndex = (headers: string[], keywords: string[]) => {
    const normalizedHeaders = headers.map(normalizeHeader);
    const normalizedKeywords = keywords.map(normalizeHeader);
    return normalizedHeaders.findIndex(h => 
      normalizedKeywords.some(k => h.includes(k))
    );
  };

  const parseFileToRows = (
    file: File,
    callback: (rows: string[][]) => void,
    errorCallback: (err: any) => void
  ) => {
    const name = file.name.toLowerCase();
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = e.target?.result;
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const rows = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1, raw: false });
          const stringRows = rows.map((r) => {
            if (!Array.isArray(r)) return [];
            return r.map((cell) => (cell !== undefined && cell !== null ? String(cell) : ''));
          });
          callback(stringRows);
        } catch (err) {
          errorCallback(err);
        }
      };
      reader.onerror = (err) => {
        errorCallback(err);
      };
      reader.readAsArrayBuffer(file);
    } else {
      Papa.parse(file, {
        header: false,
        skipEmptyLines: true,
        complete: (results) => {
          const rows = results.data as string[][];
          callback(rows);
        },
        error: (err) => {
          errorCallback(err);
        },
      });
    }
  };

  const handleParseSQP = (file: File, isNextPeriod: boolean) => {
    const statusSetter = isNextPeriod ? setCompareStatus : setCurrentStatus;
    const fileSetter = isNextPeriod ? setCompareFile : setCurrentFile;
    statusSetter('⏳ 正在解析数据...');

    parseFileToRows(
      file,
      (rows) => {
        try {
          if (rows.length < 2) throw new Error('数据空或行数不足');
          let headerIdx = -1;
          for (let i = 0; i < Math.min(rows.length, 12); i++) {
            const rowStr = rows[i].map(c => String(c || '').toLowerCase()).join('||');
            if (
              rowStr.includes('搜索查询') || 
              rowStr.includes('查询') || 
              rowStr.includes('search query') || 
              rowStr.includes('query score') ||
              rowStr.includes('曝光量') ||
              rowStr.includes('点击量') ||
              rowStr.includes('购买量')
            ) {
              headerIdx = i;
              break;
            }
          }
          if (headerIdx === -1) {
            for (let i = 0; i < Math.min(rows.length, 10); i++) {
              if (rows[i] && rows[i].length >= 15) {
                headerIdx = i;
                break;
              }
            }
          }
          if (headerIdx === -1) {
            headerIdx = 0;
          }
          const headers = rows[headerIdx].map(h => String(h || '').trim());
          const colMap = {
            kw: findColIndex(headers, ['搜索查询']),
            qc: findColIndex(headers, ['搜索查询数量']),
            asin: findColIndex(headers, ['asin', '商品']),
            imp: findColIndex(headers, ['曝光量：asin 数量', '曝光量：asin 计数', '曝光量：asin']),
            clk: findColIndex(headers, ['点击量：asin 数量', '点击量：asin 计数', '点击量：asin']),
            ord: findColIndex(headers, ['购买量：asin 数量', '购买量：asin 计数', '购买量：asin']),
            mp: findColIndex(headers, ['购买量：价格（中位数）']),
            ap: findColIndex(headers, ['购买量：asin 价格（中位数）']),
            tc: findColIndex(headers, ['点击量：总数', '点击量：总次数', '总点击量']),
            to: findColIndex(headers, ['购买量：总数', '购买量：总次数', '总购买量']),
            ti: findColIndex(headers, ['曝光量：总数', '曝光量：总数量', '总曝光量', '曝光量：总次数']),
            buyShareRaw: findColIndex(headers, ['购买量；购买量：ASIN 占比%', '购买量：asin 占有率', '购买量：asin 占比', '购买量：占有率', '购买量：占比']),
            clickShareRaw: findColIndex(headers, ['点击量：ASIN 占比%', '点击量：asin 占有率', '点击量：asin 占比', '点击量：占有率', '点击量：占比']),
            impShareRaw: findColIndex(headers, ['曝光量：ASIN 占比%', '曝光量：asin 占有率', '曝光量：asin 占比', '曝光量：占有率', '曝光量：占比'])
          };

          // 无论表头字段如何改变，定义都是一样的。若无法智能配对上，则均使用原表头段的固定位置序列进行解析分析
          if (colMap.kw === -1) colMap.kw = 0;
          if (colMap.qc === -1) colMap.qc = 2;
          if (colMap.ti === -1) colMap.ti = 3;
          if (colMap.imp === -1) colMap.imp = 4;
          if (colMap.impShareRaw === -1) colMap.impShareRaw = 5;
          if (colMap.tc === -1) colMap.tc = 6;
          if (colMap.clk === -1) colMap.clk = 8;
          if (colMap.clickShareRaw === -1) colMap.clickShareRaw = 9;
          if (colMap.to === -1) colMap.to = 24;
          if (colMap.ord === -1) colMap.ord = 26;
          if (colMap.buyShareRaw === -1) colMap.buyShareRaw = 27;
          if (colMap.mp === -1) colMap.mp = 28;
          if (colMap.ap === -1) colMap.ap = 29;

          const parsedRows: any[] = [];
          const asinSet = new Set<string>();

          for (let i = headerIdx + 1; i < rows.length; i++) {
            const r = rows[i];
            if (!r || r.length <= colMap.kw) continue;
            
            // 安全值辅助函数，防止超出当前行的数组范围干扰正常运行
            const getSafeVal = (idx: number) => {
              if (idx === -1 || idx >= r.length) return undefined;
              return r[idx];
            };

            const kw = String(getSafeVal(colMap.kw) || '').trim();
            if (!kw) continue;
            const asin = colMap.asin !== -1 ? String(getSafeVal(colMap.asin) || '').trim() : '未标注';
            if (asin && asin !== '未标注') asinSet.add(asin);

            parsedRows.push({
              kw,
              qc: colMap.qc !== -1 ? cleanNum(getSafeVal(colMap.qc)) : 0,
              asin,
              imp: cleanNum(getSafeVal(colMap.imp)),
              clk: cleanNum(getSafeVal(colMap.clk)),
              ord: cleanNum(getSafeVal(colMap.ord)),
              mp: colMap.mp !== -1 ? String(getSafeVal(colMap.mp) || '-').trim() : '-',
              ap: colMap.ap !== -1 ? String(getSafeVal(colMap.ap) || '-').trim() : '-',
              tc: colMap.tc !== -1 ? cleanNum(getSafeVal(colMap.tc)) : 0,
              to: colMap.to !== -1 ? cleanNum(getSafeVal(colMap.to)) : 0,
              ti: colMap.ti !== -1 ? cleanNum(getSafeVal(colMap.ti)) : 0,
              buyShareRaw: colMap.buyShareRaw !== -1 ? cleanSqpShare(getSafeVal(colMap.buyShareRaw)) : 0,
              clickShareRaw: colMap.clickShareRaw !== -1 ? cleanSqpShare(getSafeVal(colMap.clickShareRaw)) : 0,
              impShareRaw: colMap.impShareRaw !== -1 ? cleanSqpShare(getSafeVal(colMap.impShareRaw)) : 0,
            });
          }

          // Filter rows
          const validRows = parsedRows.filter(r => r.imp > 0 || r.clk > 0 || r.ord > 0);
          if (validRows.length === 0) {
            throw new Error('未筛选出含有本ASIN点击/曝光/购买记录的有效词条');
          }

          if (isNextPeriod) {
            setCompareRawCache(validRows);
            setCompareFile(file);
            statusSetter(`✅ 载入环比数据：解析出 ${validRows.length}行 购买反馈（${asinSet.size}个ASIN）`);
          } else {
            setSqpRawCache(validRows);
            fileSetter(file);
            statusSetter(`✅ 载入当前数据：解析出 ${validRows.length}行 购买反馈（${asinSet.size}个ASIN）`);
          }
        } catch (err: any) {
          statusSetter(`❌ 错误：${err.message}`);
        }
      },
      (err) => {
        statusSetter(`❌ 文件读取错误：${err.message || err}`);
      }
    );
  };

  const generateReport = async () => {
    const raw = sqpRawCache;
    if (raw.length === 0) {
      setCurrentStatus('⚠️ 请先成功解析属于当前时段的 SQP CSV 报表');
      return;
    }
    const gI = raw.reduce((sum, r) => sum + r.imp, 0);
    const gC = raw.reduce((sum, r) => sum + r.clk, 0);
    const gO = raw.reduce((sum, r) => sum + r.ord, 0);

    const processed: SQPRow[] = raw.map(r => {
      const mc = r.tc > 0 ? r.to / r.tc : 0;
      const ac = r.clk > 0 ? r.ord / r.clk : 0;
      
      // Calculate/use Amazon defined shares
      let bs = r.buyShareRaw > 0 ? r.buyShareRaw : (r.to > 0 ? r.ord / r.to : 0);
      let cs = r.clickShareRaw > 0 ? r.clickShareRaw : (r.tc > 0 ? r.clk / r.tc : 0);
      let ims = r.impShareRaw > 0 ? r.impShareRaw : (r.ti > 0 ? r.imp / r.ti : 0);
      
      // Fallback in case both are missing (e.g. from custom inputs or mock data)
      if (bs === 0 && r.to === 0 && gO > 0) bs = r.ord / gO;
      if (cs === 0 && r.tc === 0 && gC > 0) cs = r.clk / gC;
      if (ims === 0 && r.ti === 0 && gI > 0) ims = r.imp / gI;

      const clickImpRatio = ims > 0 ? cs / ims : 0;
      const buyClickRatio = cs > 0 ? bs / cs : 0;
      const mCtr = r.ti > 0 ? r.tc / r.ti : (ims > 0 && cs > 0 && r.imp > 0 ? (r.clk / cs) / (r.imp / ims) : 0);
      const aCtr = r.imp > 0 ? r.clk / r.imp : 0;
      
      const mPrice = parsePriceStr(r.mp);
      const aPrice = parsePriceStr(r.ap);
      const priceRatio = mPrice > 0 ? aPrice / mPrice : 1;

      let convTag = '⚪ 承接力均衡';
      let convClass = 'bg-slate-50 text-slate-600 border border-slate-200';
      
      if (buyClickRatio < cleanPct('85%') && ac < mc && priceRatio >= 0.95) {
        convTag = '🔴 价格/价值错配';
        convClass = 'bg-red-50 text-red-600 border border-red-100';
      } else if (buyClickRatio > cleanPct('115%') && ac > mc) {
        convTag = '🟢 承接力碾压';
        convClass = 'bg-emerald-50 text-emerald-600 border border-emerald-100';
      }

      const d = getDiagnosis({ impShare: ims, clickShare: cs, buyShare: bs });

      return {
        ...r,
        buyShare: bs,
        clickShare: cs,
        impShare: ims,
        marketCVR: mc,
        asinCVR: ac,
        marketCTR: mCtr,
        asinCTR: aCtr,
        clickImpRatio,
        buyClickRatio,
        convTag,
        convClass,
        advice: d.ad,
        adviceColor: d.c,
        marketPrice: mPrice,
        asinPrice: aPrice
      };
    });

    const detectedAsins = [...new Set(processed.map(row => row.asin).filter(asin => asin && asin !== '未标注'))];
    if (!currentFile) {
      setCurrentStatus('请先选择当前 SQP 文件。');
      return;
    }
    if (!detectedAsins.length) {
      setCurrentStatus('文件中没有识别到 ASIN，请确认上传的是 Amazon Search Query Performance 原始报表。');
      return;
    }
    setSaveBusy(true);
    try {
      for (const asin of detectedAsins) {
        const asinRows = processed.filter(row => row.asin === asin);
        await onSaveReport(currentFile, asin, marketplace, period, asinRows);
      }
    } catch (error) {
      setCurrentStatus(`云端保存失败：${error instanceof Error ? error.message : '请重试'}`);
      setSaveBusy(false);
      return;
    }
    setSaveBusy(false);
    setSqpRows(processed);
    onDataLoaded();
    setSqpLimit(100);
    setCurrentStatus(`🚀 分析已生成并保存 ${detectedAsins.length} 个 ASIN 记录，可在“历史分析”中重新打开。`);
  };

  const generateCompareReport = () => {
    if (sqpRows.length === 0) {
      setCompareStatus('⚠️ 请先点击上方“生成占比诊断报告”激活当前时段的诊断数据组');
      return;
    }
    const rawNext = compareRawCache;
    if (rawNext.length === 0) {
      setCompareStatus('⚠️ 请先上传并解析下一个时段对比的 SQP 报告数据');
      return;
    }

    const gI_next = rawNext.reduce((sum, r) => sum + r.imp, 0);
    const gC_next = rawNext.reduce((sum, r) => sum + r.clk, 0);
    const gO_next = rawNext.reduce((sum, r) => sum + r.ord, 0);

    const nextProcessed = rawNext.map(r => {
      const mc = r.tc > 0 ? r.to / r.tc : 0;
      const ac = r.clk > 0 ? r.ord / r.clk : 0;

      let bs = r.buyShareRaw > 0 ? r.buyShareRaw : (r.to > 0 ? r.ord / r.to : 0);
      let cs = r.clickShareRaw > 0 ? r.clickShareRaw : (r.tc > 0 ? r.clk / r.tc : 0);
      let ims = r.impShareRaw > 0 ? r.impShareRaw : (r.ti > 0 ? r.imp / r.ti : 0);

      if (bs === 0 && r.to === 0 && gO_next > 0) bs = r.ord / gO_next;
      if (cs === 0 && r.tc === 0 && gC_next > 0) cs = r.clk / gC_next;
      if (ims === 0 && r.ti === 0 && gI_next > 0) ims = r.imp / gI_next;

      const mCtr = r.ti > 0 ? r.tc / r.ti : (ims > 0 && cs > 0 && r.imp > 0 ? (r.clk / cs) / (r.imp / ims) : 0);
      const aCtr = r.imp > 0 ? r.clk / r.imp : 0;

      return {
        kw: r.kw,
        qc: r.qc,
        ord: r.ord,
        clk: r.clk,
        imp: r.imp,
        to: r.to,
        tc: r.tc,
        ti: r.ti,
        buyShare: bs,
        clickShare: cs,
        impShare: ims,
        marketCVR: mc,
        asinCVR: ac,
        marketCTR: mCtr,
        asinCTR: aCtr,
        marketPrice: parsePriceStr(r.mp),
        asinPrice: parsePriceStr(r.ap)
      };
    });

    const currentMap = new Map<string, SQPRow>();
    sqpRows.forEach(item => currentMap.set(item.kw.toLowerCase(), item));

    const allKeys = new Set<string>();
    currentMap.forEach((_, k) => allKeys.add(k));
    nextProcessed.forEach(item => allKeys.add(item.kw.toLowerCase()));

    const compareList: CompareRow[] = [];

    allKeys.forEach(key => {
      // Find matches
      const cur = currentMap.get(key) || {
        kw: key, qc: 0, ord: 0, clk: 0, imp: 0, buyShare: 0, clickShare: 0, impShare: 0,
        to: 0, tc: 0, ti: 0,
        marketCVR: 0, asinCVR: 0, marketCTR: 0, asinCTR: 0, marketPrice: 0, asinPrice: 0
      };
      const nxt = nextProcessed.find(r => r.kw.toLowerCase() === key) || {
        kw: key, qc: 0, ord: 0, clk: 0, imp: 0, buyShare: 0, clickShare: 0, impShare: 0,
        to: 0, tc: 0, ti: 0,
        marketCVR: 0, asinCVR: 0, marketCTR: 0, asinCTR: 0, marketPrice: 0, asinPrice: 0
      };

      const qcChange = cur.qc === 0 ? (nxt.qc === 0 ? 0 : 1.0) : ((nxt.qc - cur.qc) / cur.qc);
      const ordChange = cur.ord === 0 ? (nxt.ord === 0 ? 0 : 1.0) : ((nxt.ord - cur.ord) / cur.ord);
      const clkChange = cur.clk === 0 ? (nxt.clk === 0 ? 0 : 1.0) : ((nxt.clk - cur.clk) / cur.clk);
      const impChange = cur.imp === 0 ? (nxt.imp === 0 ? 0 : 1.0) : ((nxt.imp - cur.imp) / cur.imp);
      
      const buyShareDiff = nxt.buyShare - cur.buyShare;
      const clickShareDiff = nxt.clickShare - cur.clickShare;
      const impShareDiff = nxt.impShare - cur.impShare;
      
      const marketPriceChange = cur.marketPrice === 0 ? (nxt.marketPrice === 0 ? 0 : 1.0) : ((nxt.marketPrice - cur.marketPrice) / cur.marketPrice);
      const asinPriceChange = cur.asinPrice === 0 ? (nxt.asinPrice === 0 ? 0 : 1.0) : ((nxt.asinPrice - cur.asinPrice) / cur.asinPrice);
      
      const marketCTRChange = cur.marketCTR === 0 ? (nxt.marketCTR === 0 ? 0 : 1.0) : ((nxt.marketCTR - cur.marketCTR) / cur.marketCTR);
      const asinCTRChange = cur.asinCTR === 0 ? (nxt.asinCTR === 0 ? 0 : 1.0) : ((nxt.asinCTR - cur.asinCTR) / cur.asinCTR);

      const marketCVRChange = cur.marketCVR === 0 ? (nxt.marketCVR === 0 ? 0 : 1.0) : ((nxt.marketCVR - cur.marketCVR) / cur.marketCVR);
      const asinCVRChange = cur.asinCVR === 0 ? (nxt.asinCVR === 0 ? 0 : 1.0) : ((nxt.asinCVR - cur.asinCVR) / cur.asinCVR);

      // Keep human spelling from SQP if possible
      const displayKw = sqpRows.find(xr => xr.kw.toLowerCase() === key)?.kw || nextProcessed.find(xr => xr.kw.toLowerCase() === key)?.kw || key;

      compareList.push({
        kw: displayKw,
        qc_current: cur.qc, qc_next: nxt.qc, qc_change: qcChange,
        ord_current: cur.ord, ord_next: nxt.ord, ord_change: ordChange,
        clk_current: cur.clk, clk_next: nxt.clk, clk_change: clkChange,
        imp_current: cur.imp, imp_next: nxt.imp, imp_change: impChange,
        buyShare_current: cur.buyShare, buyShare_next: nxt.buyShare, buyShare_change: buyShareDiff,
        clickShare_current: cur.clickShare, clickShare_next: nxt.clickShare, clickShare_change: clickShareDiff,
        impShare_current: cur.impShare, impShare_next: nxt.impShare, impShare_change: impShareDiff,
        marketPrice_current: cur.marketPrice, marketPrice_next: nxt.marketPrice, marketPrice_change: marketPriceChange,
        asinPrice_current: cur.asinPrice, asinPrice_next: nxt.asinPrice, asinPrice_change: asinPriceChange,
        marketCTR_current: cur.marketCTR, marketCTR_next: nxt.marketCTR, marketCTR_change: marketCTRChange,
        asinCTR_current: cur.asinCTR, asinCTR_next: nxt.asinCTR, asinCTR_change: asinCTRChange,
        marketCVR_current: cur.marketCVR, marketCVR_next: nxt.marketCVR, marketCVR_change: marketCVRChange,
        asinCVR_current: cur.asinCVR, asinCVR_next: nxt.asinCVR, asinCVR_change: asinCVRChange,
        trend: getTrendInterpretation(cur, nxt),
        to_current: cur.to,
        to_next: nxt.to,
        tc_current: cur.tc,
        tc_next: nxt.tc,
        ti_current: cur.ti,
        ti_next: nxt.ti
      });
    });

    setCompareRows(compareList);
    setCompareLimit(100);
    setCompareStatus('🔄 环比分析成功建立！您可在底部环比面板中横向对比并追踪指标动线。');
  };

  const handleSqpSort = (key: keyof SQPRow) => {
    setSqpSort(prev => {
      if (prev.key === key) {
        return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
      }
      return { key, dir: 'desc' };
    });
    setSqpLimit(100);
  };

  const handleCompareSort = (key: keyof CompareRow) => {
    setCompareSort(prev => {
      if (prev.key === key) {
        return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
      }
      return { key, dir: 'desc' };
    });
    setCompareLimit(100);
  };

  // Word stems calculations inside SqpPanel component
  const rawStemsList = useMemo(() => {
    return computeSqpStemAnalysis(sqpRows, stemType, hideStopWords, minFreq);
  }, [sqpRows, stemType, hideStopWords, minFreq]);

  const processedStemsList = useMemo(() => {
    let result = [...rawStemsList];
    if (stemSearchQuery) {
      const q = stemSearchQuery.toLowerCase().trim();
      result = result.filter(s => 
        s.stem.toLowerCase().includes(q) || 
        (s.keywords && s.keywords.some(kw => kw.toLowerCase().includes(q)))
      );
    }
    if (selectedStemRole) {
      result = result.filter(s => s.role.includes(selectedStemRole));
    }
    
    // Core sorting
    const { key, dir } = stemSortState;
    result.sort((a, b) => {
      const valA = a[key as keyof typeof a];
      const valB = b[key as keyof typeof b];
      if (typeof valA === 'string' && typeof valB === 'string') {
        return dir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      return dir === 'asc' ? (valA as number) - (valB as number) : (valB as number) - (valA as number);
    });
    return result;
  }, [rawStemsList, stemSearchQuery, selectedStemRole, stemSortState]);

  const stemTotals = useMemo(() => {
    if (processedStemsList.length === 0) return null;
    const count = processedStemsList.length;
    const originalWordsCount = processedStemsList.reduce((acc, r) => acc + (r.count || 0), 0);
    const totalQc = processedStemsList.reduce((acc, r) => acc + (r.totalQc || 0), 0);
    const totalMarketClk = processedStemsList.reduce((acc, r) => acc + (r.totalMarketClk || 0), 0);
    const totalMarketOrd = processedStemsList.reduce((acc, r) => acc + (r.totalMarketOrd || 0), 0);
    const marketCvr = totalMarketClk > 0 ? (totalMarketOrd / totalMarketClk) : 0;
    
    const totalAsinImp = processedStemsList.reduce((acc, r) => acc + (r.totalAsinImp || 0), 0);
    const totalAsinClk = processedStemsList.reduce((acc, r) => acc + (r.totalAsinClk || 0), 0);
    const totalAsinOrd = processedStemsList.reduce((acc, r) => acc + (r.totalAsinOrd || 0), 0);
    const asinCvr = totalAsinClk > 0 ? (totalAsinOrd / totalAsinClk) : 0;

    const clickShare = totalMarketClk > 0 ? (totalAsinClk / totalMarketClk) : 0;
    const buyShare = totalMarketOrd > 0 ? (totalAsinOrd / totalMarketOrd) : 0;

    return {
      count,
      originalWordsCount,
      totalQc,
      totalMarketClk,
      totalMarketOrd,
      marketCvr,
      totalAsinImp,
      totalAsinClk,
      totalAsinOrd,
      asinCvr,
      clickShare,
      buyShare
    };
  }, [processedStemsList]);

  const handleStemSort = (key: string) => {
    setStemSortState(prev => {
      if (prev.key === key) {
        return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
      }
      return { key, dir: 'desc' };
    });
  };

  const exportSqpStemsXlsx = (listToExport: any[]) => {
    if (listToExport.length === 0) return;
    const wb = XLSX.utils.book_new();
    const headers = [
      '词根短词', '拆分层级', '关联长尾原词量', '大盘总搜索量 (QC)', '大盘总点击 (TC)', 
      '大盘总购买 (TO)', '大盘平均 CVR (%)', '本ASIN总曝光 (IMP)', '本ASIN总点击 (CLK)', 
      '本ASIN总购买 (ORD)', '本ASIN转化率 (%)', '点击占有率 (%)', '购买占有率 (%)', '运营诊断标签', '运营分析建议'
    ];
    const rows = listToExport.map(item => [
      item.stem,
      item.type === '1-word' ? '1词单个词根' : item.type === '2-word' ? '2词并接词组' : '3词长尾语义',
      item.count,
      item.totalQc,
      item.totalMarketClk,
      item.totalMarketOrd,
      parseFloat((item.marketCvr * 100).toFixed(2)),
      item.totalAsinImp,
      item.totalAsinClk,
      item.totalAsinOrd,
      parseFloat((item.asinCvr * 100).toFixed(2)),
      parseFloat((item.clickShare * 100).toFixed(2)),
      parseFloat((item.buyShare * 100).toFixed(2)),
      item.role,
      item.advice
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, 'SQP大盘双端词根深度聚合');
    XLSX.writeFile(wb, `SQP双端词根分析报告_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const processedSqpList = useMemo(() => {
    let result = [...sqpRows];
    if (searchQuery) {
      result = result.filter(r => r.kw.toLowerCase().includes(searchQuery.toLowerCase()));
    }
    if (selectedTag) {
      result = result.filter(r => r.convTag === selectedTag);
    }
    if (selectedCluster) {
      result = result.filter(r => {
        const bi = r.buyClickRatio;
        const ci = r.clickImpRatio;
        if (selectedCluster === 'defense') {
          return ci >= 1.0 && bi >= 1.0;
        } else if (selectedCluster === 'exploration') {
          return ci >= 1.0 && bi < 1.0;
        } else if (selectedCluster === 'harvest') {
          return ci < 1.0 && bi >= 1.0;
        } else if (selectedCluster === 'idling') {
          return ci < 1.0 && bi < 1.0;
        }
        return true;
      });
    }
    if (sqpSort.key) {
      const { key, dir } = sqpSort;
      result.sort((a, b) => {
        const valA = a[key];
        const valB = b[key];
        if (typeof valA === 'string' && typeof valB === 'string') {
          return dir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
        return dir === 'asc' ? (valA as number) - (valB as number) : (valB as number) - (valA as number);
      });
    }
    return result;
  }, [sqpRows, searchQuery, selectedTag, selectedCluster, sqpSort]);

  const sqpTotals = useMemo(() => {
    if (processedSqpList.length === 0) return null;
    const qc = processedSqpList.reduce((acc, r) => acc + r.qc, 0);
    const ord = processedSqpList.reduce((acc, r) => acc + r.ord, 0);
    const clk = processedSqpList.reduce((acc, r) => acc + r.clk, 0);
    const imp = processedSqpList.reduce((acc, r) => acc + r.imp, 0);
    
    const totalTo = processedSqpList.reduce((acc, r) => acc + r.to, 0);
    const totalTc = processedSqpList.reduce((acc, r) => acc + r.tc, 0);
    const totalTi = processedSqpList.reduce((acc, r) => acc + (r.ti || 0), 0);
    
    // Aggregated metrics are total ASIN action / total Keyword action on Amazon SQP standard
    const buyShare = totalTo > 0 ? ord / totalTo : 0;
    const clickShare = totalTc > 0 ? clk / totalTc : 0;
    const impShare = totalTi > 0 ? imp / totalTi : 0;
    
    const marketPriceAvg = processedSqpList.reduce((acc, r) => acc + (r.marketPrice || 0), 0) / processedSqpList.length;
    const asinPriceAvg = processedSqpList.reduce((acc, r) => acc + (r.asinPrice || 0), 0) / processedSqpList.length;

    const marketCVR = totalTc > 0 ? totalTo / totalTc : 0;
    const asinCVR = clk > 0 ? ord / clk : 0;
    const marketCTR = totalTi > 0 ? totalTc / totalTi : (impShare > 0 && clickShare > 0 && imp > 0 ? (clk / clickShare) / (imp / impShare) : 0);
    const asinCTR = imp > 0 ? clk / imp : 0;

    const clickImpRatio = impShare > 0 ? clickShare / impShare : 0;
    const buyClickRatio = clickShare > 0 ? buyShare / clickShare : 0;

    return {
      qc, ord, clk, imp,
      buyShare, clickShare, impShare,
      marketPriceAvg, asinPriceAvg,
      marketCVR, asinCVR,
      marketCTR, asinCTR,
      clickImpRatio, buyClickRatio
    };
  }, [processedSqpList]);

  const processedCompareList = useMemo(() => {
    let result = [...compareRows];
    if (searchQuery) {
      result = result.filter(r => r.kw.toLowerCase().includes(searchQuery.toLowerCase()));
    }
    if (compareSort.key) {
      const { key, dir } = compareSort;
      result.sort((a, b) => {
        const valA = a[key];
        const valB = b[key];
        if (typeof valA === 'string' && typeof valB === 'string') {
          return dir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
        return dir === 'asc' ? (valA as number) - (valB as number) : (valB as number) - (valA as number);
      });
    }
    return result;
  }, [compareRows, searchQuery, compareSort]);

  const compareTotals = useMemo(() => {
    if (processedCompareList.length === 0) return null;
    const qc_current = processedCompareList.reduce((acc, r) => acc + r.qc_current, 0);
    const qc_next = processedCompareList.reduce((acc, r) => acc + r.qc_next, 0);
    const qc_change = qc_current > 0 ? (qc_next - qc_current) / qc_current : 0;

    const ord_current = processedCompareList.reduce((acc, r) => acc + r.ord_current, 0);
    const ord_next = processedCompareList.reduce((acc, r) => acc + r.ord_next, 0);
    const ord_change = ord_current > 0 ? (ord_next - ord_current) / ord_current : 0;

    const clk_current = processedCompareList.reduce((acc, r) => acc + r.clk_current, 0);
    const clk_next = processedCompareList.reduce((acc, r) => acc + r.clk_next, 0);
    const clk_change = clk_current > 0 ? (clk_next - clk_current) / clk_current : 0;

    const totalTo_current = processedCompareList.reduce((acc, r) => acc + (r.to_current || 0), 0);
    const totalTo_next = processedCompareList.reduce((acc, r) => acc + (r.to_next || 0), 0);

    const totalTc_current = processedCompareList.reduce((acc, r) => acc + (r.tc_current || 0), 0);
    const totalTc_next = processedCompareList.reduce((acc, r) => acc + (r.tc_next || 0), 0);

    const totalTi_current = processedCompareList.reduce((acc, r) => acc + (r.ti_current || 0), 0);
    const totalTi_next = processedCompareList.reduce((acc, r) => acc + (r.ti_next || 0), 0);

    const imp_current = processedCompareList.reduce((acc, r) => acc + r.imp_current, 0);
    const imp_next = processedCompareList.reduce((acc, r) => acc + r.imp_next, 0);

    const buyShare_current = totalTo_current > 0 ? ord_current / totalTo_current : 0;
    const buyShare_next = totalTo_next > 0 ? ord_next / totalTo_next : 0;
    const buyShare_change = buyShare_next - buyShare_current;

    const clickShare_current = totalTc_current > 0 ? clk_current / totalTc_current : 0;
    const clickShare_next = totalTc_next > 0 ? clk_next / totalTc_next : 0;
    const clickShare_change = clickShare_next - clickShare_current;

    const impShare_current = totalTi_current > 0 ? imp_current / totalTi_current : 0;
    const impShare_next = totalTi_next > 0 ? imp_next / totalTi_next : 0;
    const impShare_change = impShare_next - impShare_current;

    const marketPrice_current = processedCompareList.reduce((acc, r) => acc + r.marketPrice_current, 0) / processedCompareList.length;
    const marketPrice_next = processedCompareList.reduce((acc, r) => acc + r.marketPrice_next, 0) / processedCompareList.length;

    const asinCVR_current = clk_current > 0 ? ord_current / clk_current : 0;
    const asinCVR_next = clk_next > 0 ? ord_next / clk_next : 0;
    const asinCVR_change = asinCVR_current > 0 ? (asinCVR_next - asinCVR_current) / asinCVR_current : 0;

    const marketCVR_current = totalTc_current > 0 ? totalTo_current / totalTc_current : 0;
    const marketCVR_next = totalTc_next > 0 ? totalTo_next / totalTc_next : 0;
    const marketCVR_change = marketCVR_current > 0 ? (marketCVR_next - marketCVR_current) / marketCVR_current : 0;

    const marketCTR_current = totalTi_current > 0 ? totalTc_current / totalTi_current : 0;
    const marketCTR_next = totalTi_next > 0 ? totalTc_next / totalTi_next : 0;
    const marketCTR_change = marketCTR_current > 0 ? (marketCTR_next - marketCTR_current) / marketCTR_current : 0;

    const asinCTR_current = imp_current > 0 ? clk_current / imp_current : 0;
    const asinCTR_next = imp_next > 0 ? clk_next / imp_next : 0;
    const asinCTR_change = asinCTR_current > 0 ? (asinCTR_next - asinCTR_current) / asinCTR_current : 0;

    return {
      qc_current, qc_next, qc_change,
      ord_current, ord_next, ord_change,
      clk_current, clk_next, clk_change,
      buyShare_current, buyShare_next, buyShare_change,
      clickShare_current, clickShare_next, clickShare_change,
      impShare_current, impShare_next, impShare_change,
      marketPrice_current, marketPrice_next,
      marketCTR_current, marketCTR_next, marketCTR_change,
      asinCTR_current, asinCTR_next, asinCTR_change,
      marketCVR_current, marketCVR_next, marketCVR_change,
      asinCVR_current, asinCVR_next, asinCVR_change
    };
  }, [processedCompareList]);

  const exportCurrentXlsx = () => {
    if (sqpRows.length === 0) return;
    const wb = XLSX.utils.book_new();
    const headers = [
      '关键词', '搜索量', 'ASIN曝光', 'ASIN点击', 'ASIN订单', 
      '购买占比', '点击占比', '曝光占比', 
      '大盘点击率CTR', '本ASIN点击率CTR', '点击/曝光比值(流量力)', '购买/点击比值(承接力)', 
      '市场价格中值', 'ASIN价格中值', '大盘CVR', '您的CVR', '承接力标签', '漏斗量化诊断建议'
    ];
    const rows = sqpRows.map(r => [
      r.kw, r.qc, r.imp, r.clk, r.ord, 
      (r.buyShare * 100).toFixed(2) + '%', (r.clickShare * 100).toFixed(2) + '%', (r.impShare * 100).toFixed(2) + '%',
      (r.marketCTR * 100).toFixed(2) + '%', (r.asinCTR * 100).toFixed(2) + '%',
      r.clickImpRatio.toFixed(2) + 'x', r.buyClickRatio.toFixed(2) + 'x',
      r.mp, r.ap, (r.marketCVR * 100).toFixed(2) + '%', (r.asinCVR * 100).toFixed(2) + '%',
      r.convTag, r.advice
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, '当前时段SQP明细');
    XLSX.writeFile(wb, `SQP_市占大盘诊断_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const exportCompareXlsxVal = () => {
    if (compareRows.length === 0) return;
    const wb = XLSX.utils.book_new();
    const headers = [
      '核心词', '搜索量(前)', '搜索量(后)', '搜索环比', '订单(前)', '订单(后)', '订单环比',
      '点击(前)', '点击(后)', '点击环比', '曝光(前)', '曝光(后)', '曝光环比',
      '购买占有(前)', '购买占有(后)', '购买比绝对差', '点击占有(前)', '点击占有(后)', '点击比绝对差',
      '市场单价(前)', '市场单价(后)', 'ASIN单价(前)', 'ASIN单价(后)',
      '大盘CTR(前)', '大盘CTR(后)', '大盘CTR环比', '本ASIN CTR(前)', '本ASIN CTR(后)', '本ASIN CTR环比',
      '大盘平均CVR(前)', '大盘平均CVR(后)', '大盘平均CVR环比', 'ASIN转化率(前)', 'ASIN转化率(后)', 'ASIN转化率环比', '趋势量度解读'
    ];
    const rows = compareRows.map(r => [
      r.kw, r.qc_current, r.qc_next, (r.qc_change * 100).toFixed(1) + '%',
      r.ord_current, r.ord_next, (r.ord_change * 100).toFixed(1) + '%',
      r.clk_current, r.clk_next, (r.clk_change * 100).toFixed(1) + '%',
      r.imp_current, r.imp_next, (r.imp_change * 100).toFixed(1) + '%',
      (r.buyShare_current * 100).toFixed(2) + '%', (r.buyShare_next * 100).toFixed(2) + '%', (r.buyShare_change * 100).toFixed(2) + ' pp',
      (r.clickShare_current * 100).toFixed(2) + '%', (r.clickShare_next * 100).toFixed(2) + '%', (r.clickShare_change * 100).toFixed(2) + ' pp',
      r.marketPrice_current, r.marketPrice_next, r.asinPrice_current, r.asinPrice_next,
      (r.marketCTR_current * 100).toFixed(2) + '%', (r.marketCTR_next * 100).toFixed(2) + '%', (r.marketCTR_change * 100).toFixed(1) + '%',
      (r.asinCTR_current * 100).toFixed(2) + '%', (r.asinCTR_next * 100).toFixed(2) + '%', (r.asinCTR_change * 100).toFixed(1) + '%',
      (r.marketCVR_current * 100).toFixed(2) + '%', (r.marketCVR_next * 100).toFixed(2) + '%', (r.marketCVR_change * 100).toFixed(1) + '%',
      (r.asinCVR_current * 100).toFixed(2) + '%', (r.asinCVR_next * 100).toFixed(2) + '%', (r.asinCVR_change * 100).toFixed(1) + '%',
      r.trend
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, 'SQP环比异动追踪');
    XLSX.writeFile(wb, `SQP_环比诊断对比_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const renderTrendChange = (current: number, changeVal: number) => {
    if (current === 0) return <span className="text-slate-400 font-mono">—</span>;
    const isUp = changeVal > 0;
    const isZero = changeVal === 0;
    const displayNum = Math.abs(changeVal * 100).toFixed(1) + '%';
    return (
      <span className={`inline-flex items-center gap-0.5 font-mono font-medium text-xs ${isUp ? 'text-emerald-600' : isZero ? 'text-slate-500' : 'text-red-500'}`}>
        {isUp ? '▲' : isZero ? '●' : '▼'} {displayNum}
      </span>
    );
  };

  const renderPointChange = (changeVal: number) => {
    const isUp = changeVal > 0;
    const isZero = changeVal === 0;
    const displayNum = Math.abs(changeVal * 100).toFixed(2) + 'pp';
    return (
      <span className={`inline-flex items-center gap-0.5 font-mono font-medium text-xs ${isUp ? 'text-emerald-600' : isZero ? 'text-slate-500' : 'text-red-500'}`}>
        {isUp ? '▲' : isZero ? '●' : '▼'} {displayNum}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* SubTab Selection Bar - Always visible at the very top of the panel */}
      <div className="flex border-b border-slate-200 pb-3 justify-between items-center flex-wrap gap-2 pt-2 bg-white rounded-xl border border-slate-200 p-4 shadow-3xs">
        <div className="flex gap-2">
          <button
            onClick={() => setSubTab('funnel')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
              subTab === 'funnel'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
            }`}
          >
            📊 SQP市占大盘漏斗诊断 (Funnel Diagnosis)
          </button>
          <button
            onClick={() => setSubTab('stems')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
              subTab === 'stems'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-805 hover:bg-slate-100'
            }`}
          >
            🧬 行业大盘/ASIN双端词根深度聚合 (Word Stems)
          </button>
          <button
            onClick={() => setSubTab('annual')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
              subTab === 'annual'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-805 hover:bg-slate-100'
            }`}
          >
            📅 年度趋势汇总 (Annual Trends)
          </button>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] font-medium text-slate-400 font-mono">
          <span>本期分析词：{sqpRows.length} 组</span>
          {subTab === 'stems' && sqpRows.length > 0 && (
            <span className="bg-blue-50 text-blue-600 px-2 py-0.5 rounded border border-blue-100 font-bold">
              分析析出 {processedStemsList.length} 组双端词根
            </span>
          )}
          <span className="bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded border border-emerald-100 font-bold">
            已加载 {Object.keys(monthlySqpData).length} 个月份数据包
          </span>
        </div>
      </div>

      {subTab !== 'annual' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 bg-white rounded-xl shadow-xs border border-slate-200 p-6">
          {/* Upload current area */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-blue-500"></span>
              1. 上传当前数据段 SQP Excel 或 CSV
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-slate-600">站点<select value={marketplace} onChange={e => setMarketplace(e.target.value as SqpMarketplace)} className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-2"><option value="US">美国 US</option><option value="CA">加拿大 CA</option><option value="UK">英国 UK</option><option value="DE">德国 DE</option><option value="FR">法国 FR</option><option value="IT">意大利 IT</option><option value="ES">西班牙 ES</option><option value="JP">日本 JP</option><option value="MX">墨西哥 MX</option><option value="AU">澳大利亚 AU</option></select></label>
              <label className="text-xs text-slate-600">分析周期（可选）<input value={period} onChange={e => setPeriod(e.target.value)} placeholder="如 2026-W41" className="mt-1 w-full rounded-md border border-slate-200 px-2 py-2" /></label>
            </div>
            <label className="group flex flex-col items-center justify-center border-2 border-dashed border-slate-200 rounded-lg p-5 cursor-pointer bg-slate-50/50 hover:bg-blue-50/20 hover:border-blue-400 transition-all">
              <FileText className="w-8 h-8 text-slate-400 group-hover:text-blue-500 transition-colors mb-2" />
              <span className="text-xs font-semibold text-slate-600 group-hover:text-blue-600 transition-colors">
                {currentFile ? currentFile.name : '点击或拖拽上传本期 Excel(XLS/XLSX) 或 CSV 文件'}
              </span>
              <span className="text-[10px] text-slate-400 mt-1">支持 Search Query Performance 原始报表</span>
              <input 
                type="file" 
                accept=".csv,.txt,.xls,.xlsx" 
                className="hidden" 
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) handleParseSQP(e.target.files[0], false);
                }} 
              />
            </label>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono text-slate-500 truncate max-w-[280px]">
                {currentStatus || '未加载当前数据包'}
              </span>
              <button 
                onClick={generateReport}
                disabled={!currentFile || saveBusy}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold shadow-xs flex items-center gap-1 transition-all ${
                  currentFile && !saveBusy ? 'bg-blue-600 hover:bg-blue-700 text-white cursor-pointer' : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" /> {saveBusy ? '保存中…' : '生成并保存分析'}
              </button>
            </div>
          </div>

          {/* Upload WoW area */}
          <div className="space-y-3 border-t lg:border-t-0 lg:border-l border-slate-100 lg:pl-6 pt-6 lg:pt-0">
            <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-500"></span>
              2. 上传环比段 (未来段) SQP Excel 或 CSV
            </h3>
            <label className="group flex flex-col items-center justify-center border-2 border-dashed border-slate-200 rounded-lg p-5 cursor-pointer bg-slate-50/50 hover:bg-amber-50/25 hover:border-amber-400 transition-all">
              <FileText className="w-8 h-8 text-slate-400 group-hover:text-amber-500 transition-colors mb-2" />
              <span className="text-xs font-semibold text-slate-600 group-hover:text-amber-600 transition-colors">
                {compareFile ? compareFile.name : '点击或拖拽上传下周/下月对比 Excel(XLS/XLSX) 或 CSV 文件'}
              </span>
              <span className="text-[10px] text-slate-400 mt-1">支持与本期相同的各时段分析报表</span>
              <input 
                type="file" 
                accept=".csv,.txt,.xls,.xlsx" 
                className="hidden" 
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) handleParseSQP(e.target.files[0], true);
                }} 
              />
            </label>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono text-slate-500 truncate max-w-[280px]">
                {compareStatus || '未加载环比时段数据'}
              </span>
              <button 
                onClick={generateCompareReport}
                disabled={sqpRows.length === 0 || !compareFile}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold shadow-xs flex items-center gap-1 transition-all ${
                  sqpRows.length > 0 && compareFile ? 'bg-amber-500 hover:bg-amber-600 text-white cursor-pointer' : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                }`}
              >
                <RefreshCw className="w-3.5 h-3.5" /> 交叉运行环比计算
              </button>
            </div>
          </div>
        </div>
      )}

      {(sqpRows.length > 0 || subTab === 'annual') && (
        <React.Fragment>
          {/* Sqp Stats Summary Cards - Only shown if sqpRows exist and we are not in annual */}
          {sqpRows.length > 0 && subTab !== 'annual' && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 shadow-3xs">
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center gap-3">
                <div className="p-2.5 bg-blue-50 text-blue-600 rounded-lg">
                  <BarChart3 className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">分析词包总量</p>
                  <p className="text-lg font-bold text-slate-800 font-mono">{sqpRows.length} <span className="text-xs font-normal text-slate-500">组</span></p>
                </div>
              </div>

              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center gap-3">
                <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-lg">
                  <CheckCircle className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">ASIN 总购买订单</p>
                  <p className="text-lg font-bold text-slate-800 font-mono">{stats.totalOrd} <span className="text-xs font-normal text-slate-500">单</span></p>
                </div>
              </div>

              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center gap-3">
                <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-lg">
                  <TrendingUp className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">综合转化率 (CVR)</p>
                  <p className="text-lg font-bold text-slate-800 font-mono">{(stats.avgCVR * 100).toFixed(2)}%</p>
                </div>
              </div>

              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center gap-3">
                <div className="p-2.5 bg-purple-50 text-purple-600 rounded-lg">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">爆款主图承接词</p>
                  <p className="text-lg font-bold text-slate-800 font-mono">{stats.highPerformanceCount} <span className="text-xs font-normal text-slate-500">组</span></p>
                </div>
              </div>
            </div>
          )}

          {subTab === 'funnel' ? (
            <div className="space-y-4">
              {/* 搜索行为意图聚类仪表盘 */}
              {sqpRows.length > 0 && (
                <div className="bg-slate-50/50 border border-slate-200 rounded-xl p-4 font-sans space-y-3 shadow-3xs">
                  <div className="flex justify-between items-center flex-wrap gap-2">
                    <div>
                      <h4 className="text-xs font-extrabold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                        🎯 SQP 流量行为意图矩阵聚类仪表盘 (Search Intent Clustering Map)
                      </h4>
                      <p className="text-[10.5px] text-slate-500 mt-1">
                        依据词包的 <strong>购买转化比 (Bi / 承接力)</strong> 与 <strong>点击曝光比 (Ci / 流量力)</strong>，四象限动态聚类评估流量质量与转化意图：
                      </p>
                    </div>
                    {selectedCluster && (
                      <button
                        onClick={() => setSelectedCluster(null)}
                        className="py-1 px-2.5 text-[10px] font-bold text-red-650 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-all cursor-pointer flex items-center gap-1"
                      >
                        ✕ 清除聚类过滤 (显示全部)
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {clusterStats.map((cl) => {
                      const isActive = selectedCluster === cl.key;
                      return (
                        <div
                          key={cl.key}
                          onClick={() => setSelectedCluster(isActive ? null : cl.key)}
                          className={`border rounded-xl p-3.5 transition-all cursor-pointer select-none flex flex-col justify-between relative overflow-hidden ${
                            isActive ? cl.activeClass : `${cl.color} ${cl.hoverColor}`
                          } shadow-3xs hover:scale-[1.01]`}
                          title={cl.description}
                        >
                          {/* Accent Top Bar */}
                          <div className={`absolute top-0 left-0 w-full h-1 ${isActive ? 'bg-amber-500' : 'bg-slate-200/50'}`}></div>

                          <div>
                            {/* Header row */}
                            <div className="flex justify-between items-center mb-2">
                              <span className="text-xs font-black flex items-center gap-1">
                                <span className="text-sm leading-none">{cl.emoji}</span>
                                {cl.name}
                              </span>
                              <span className={`text-[9px] uppercase font-mono px-1.5 py-0.5 rounded border font-extrabold ${cl.badgeColor}`}>
                                {cl.count} 词 ({cl.pct.toFixed(1)}%)
                              </span>
                            </div>

                            <p className="text-[10px] text-slate-500 leading-snug min-h-[44px] mb-3 border-b border-dashed border-slate-200/60 pb-2">
                              {cl.description}
                            </p>
                          </div>

                          <div className="space-y-1 font-mono text-[10px]">
                            <div className="flex justify-between items-center">
                              <span className="text-slate-400">总检索总量 (QC):</span>
                              <span className="font-bold text-slate-800">{(cl.totalQc).toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-slate-400">曝光点击拉力 (Ci):</span>
                              <span className={`font-bold ${cl.avgCi >= 1.0 ? 'text-emerald-600' : 'text-slate-705'}`}>
                                {cl.avgCi.toFixed(2)}x
                              </span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-slate-400">购买转化承接 (Bi):</span>
                              <span className={`font-bold ${cl.avgBi >= 1.0 ? 'text-emerald-600' : 'text-slate-705'}`}>
                                {cl.avgBi.toFixed(2)}x
                              </span>
                            </div>
                            <div className="flex justify-between items-center border-t border-dashed border-slate-200/60 pt-1.5 mt-1">
                              <span className="text-slate-500 font-sans font-medium">ASIN 平均转化:</span>
                              <span className="font-bold text-slate-900">
                                {(cl.clusterCVR * 100).toFixed(2)}% <span className="text-[9px] font-normal text-slate-400 font-sans">({cl.totalOrd}单)</span>
                              </span>
                            </div>
                          </div>

                          {/* Quick selection indicator */}
                          {isActive && (
                            <div className="absolute top-1 right-1 flex items-center bg-amber-500 text-white rounded-full p-0.5 shadow-sm scale-75">
                              <CheckCircle className="w-3.5 h-3.5 text-white" />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[9.5px] text-slate-400 flex items-center gap-1">
                    💡 <strong>智能下钻：</strong>点击上方聚类标签卡片，可直接过滤下表对应的原始大盘词包；再次点击可即刻恢复。
                  </p>
                </div>
              )}

              {/* Table display filter bar */}
              <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-4 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">市占大盘诊断表</h4>
                  <div className="relative max-w-xs">
                    <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-2.5" />
                    <input
                      type="text"
                      placeholder="过滤特定搜索关键词..."
                      className="pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs w-52 focus:outline-none focus:border-blue-500 text-slate-700"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-auto">
                  <button
                    onClick={exportCurrentXlsx}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 hover:border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-1.5 transition-all cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" /> 导出本期 .xlsx 报告
                  </button>
                </div>
              </div>

              {/* Quick chips filter */}
              <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-100">
                <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1 uppercase tracking-wider mr-2">
                  <Filter className="w-3 h-3" /> 打标过滤:
                </span>
                <button
                  onClick={() => setSelectedTag(null)}
                  className={`py-1 px-3 rounded-full text-xs font-medium transition-all cursor-pointer ${
                    selectedTag === null ? 'bg-slate-900 text-white' : 'bg-slate-100 hover:bg-slate-250 text-slate-600'
                  }`}
                >
                  全部词包 ({sqpRows.length})
                </button>
                {['🟢 承接力碾压', '🔴 价格/价值错配', '⚪ 承接力均衡'].map(t => {
                  const cnt = sqpRows.filter(r => r.convTag === t).length;
                  return (
                    <button
                      key={t}
                      onClick={() => setSelectedTag(t)}
                      className={`py-1 px-3 rounded-full text-xs font-medium transition-all cursor-pointer ${
                        selectedTag === t ? 'bg-slate-900 text-white' : 'bg-slate-100 hover:bg-slate-250 text-slate-600'
                      }`}
                    >
                      {t} ({cnt})
                    </button>
                  );
                })}
              </div>

              {/* Main SQP Data table view */}
              <div className="table-wrapper max-h-[500px] custom-scrollbar border border-slate-150 rounded-lg overflow-auto">
                <table className="relative w-full border-collapse">
                  <thead>
                    <tr className="bg-slate-50/70 border-b border-slate-200 text-slate-500 text-[10px] font-semibold sticky top-0 z-20 shadow-xs">
                      <th 
                        className="text-left font-semibold uppercase tracking-wider p-3 sticky left-0 bg-slate-50/90 z-30 flex items-center justify-between border-r border-slate-200"
                        style={{ width: `${firstColWidth}px`, minWidth: `${firstColWidth}px` }}
                      >
                        <span className="cursor-pointer select-none" onClick={() => handleSqpSort('kw')}>
                          搜索查询词 {sqpSort.key === 'kw' ? (sqpSort.dir === 'asc' ? '▲' : '▼') : '↕'}
                        </span>
                        <div 
                          className="w-1.5 h-6 bg-transparent hover:bg-blue-400 active:bg-blue-600 cursor-col-resize self-stretch select-none" 
                          onMouseDown={handleStartResize}
                        />
                      </th>
                      <th className="text-right font-semibold uppercase tracking-wider p-3 cursor-pointer select-none border-b border-slate-200" onClick={() => handleSqpSort('qc')}>
                        搜索查询量 {sqpSort.key === 'qc' ? (sqpSort.dir === 'asc' ? '▲' : '▼') : '↕'}
                      </th>
                      <th className="text-right font-semibold uppercase tracking-wider p-3 cursor-pointer select-none border-b border-slate-200" onClick={() => handleSqpSort('ord')}>
                        您的订单 {sqpSort.key === 'ord' ? (sqpSort.dir === 'asc' ? '▲' : '▼') : '↕'}
                      </th>
                      <th className="text-right font-semibold uppercase tracking-wider p-3 cursor-pointer select-none border-b border-slate-200" onClick={() => handleSqpSort('clk')}>
                        您的点击 {sqpSort.key === 'clk' ? (sqpSort.dir === 'asc' ? '▲' : '▼') : '↕'}
                      </th>
                      <th className="text-right font-semibold uppercase tracking-wider p-3 cursor-pointer select-none border-b border-slate-200" onClick={() => handleSqpSort('imp')}>
                        您的曝光 {sqpSort.key === 'imp' ? (sqpSort.dir === 'asc' ? '▲' : '▼') : '↕'}
                      </th>
                      <th className="text-center font-semibold uppercase tracking-wider p-3 cursor-pointer select-none border-b border-slate-200" onClick={() => handleSqpSort('buyShare')}>
                        购买占比 {sqpSort.key === 'buyShare' ? (sqpSort.dir === 'asc' ? '▲' : '▼') : '↕'}
                      </th>
                      <th className="text-center font-semibold uppercase tracking-wider p-3 cursor-pointer select-none border-b border-slate-200" onClick={() => handleSqpSort('clickShare')}>
                        点击占比 {sqpSort.key === 'clickShare' ? (sqpSort.dir === 'asc' ? '▲' : '▼') : '↕'}
                      </th>
                      <th className="text-center font-semibold uppercase tracking-wider p-3 cursor-pointer select-none border-b border-slate-200" onClick={() => handleSqpSort('impShare')}>
                        曝光占比 {sqpSort.key === 'impShare' ? (sqpSort.dir === 'asc' ? '▲' : '▼') : '↕'}
                      </th>
                      <th className="text-center font-semibold uppercase tracking-wider p-3 border-b border-slate-200">市场均价中位数</th>
                      <th className="text-center font-semibold uppercase tracking-wider p-3 border-b border-slate-200">本ASIN购买均价</th>
                      <th className="text-right font-semibold uppercase tracking-wider p-3 cursor-pointer select-none border-b border-slate-200" onClick={() => handleSqpSort('marketCTR')} title="大盘点击率 CTR：总曝光量/总次数 (大盘总点击量 ÷ 大盘总曝光量)">
                        <span className="block">大盘点击率 CTR</span>
                        <span className="text-[10px] font-normal text-slate-400 block tracking-normal">总曝光量/总次数 {sqpSort.key === 'marketCTR' ? (sqpSort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
                      </th>
                      <th className="text-right font-semibold uppercase tracking-wider p-3 cursor-pointer select-none border-b border-slate-200" onClick={() => handleSqpSort('asinCTR')} title="本ASIN点击率 CTR: 曝光量：ASIN 计数/点击量：ASIN 数量 (本ASIN点击量 ÷ 本ASIN曝光量)">
                        <span className="block">本 ASIN 点击率 CTR</span>
                        <span className="text-[10px] font-normal text-emerald-600 block tracking-normal">曝光量:计数/点击量:数量 {sqpSort.key === 'asinCTR' ? (sqpSort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
                      </th>
                      <th className="text-right font-semibold uppercase tracking-wider p-3 cursor-pointer select-none border-b border-slate-200" onClick={() => handleSqpSort('marketCVR')}>
                        大盘平均 CVR {sqpSort.key === 'marketCVR' ? (sqpSort.dir === 'asc' ? '▲' : '▼') : '↕'}
                      </th>
                      <th className="text-right font-semibold uppercase tracking-wider p-3 cursor-pointer select-none border-b border-slate-200" onClick={() => handleSqpSort('asinCVR')}>
                        本 ASIN CVR {sqpSort.key === 'asinCVR' ? (sqpSort.dir === 'asc' ? '▲' : '▼') : '↕'}
                      </th>
                      <th className="text-center font-semibold uppercase tracking-wider p-3 cursor-pointer select-none border-b border-slate-200" onClick={() => handleSqpSort('clickImpRatio')}>
                        点曝占(流量力) {sqpSort.key === 'clickImpRatio' ? (sqpSort.dir === 'asc' ? '▲' : '▼') : '↕'}
                      </th>
                      <th className="text-center font-semibold uppercase tracking-wider p-3 cursor-pointer select-none border-b border-slate-200" onClick={() => handleSqpSort('buyClickRatio')}>
                        购点占(承接力) {sqpSort.key === 'buyClickRatio' ? (sqpSort.dir === 'asc' ? '▲' : '▼') : '↕'}
                      </th>
                      <th className="text-center font-semibold uppercase tracking-wider p-3 border-b border-slate-200 w-[110px] min-w-[110px] whitespace-nowrap">流量意图聚类</th>
                      <th className="text-center font-semibold uppercase tracking-wider p-3 border-b border-slate-200 w-[120px] min-w-[120px] whitespace-nowrap">详情页转化标签</th>
                      <th className="text-left font-semibold uppercase tracking-wider p-3 min-w-[280px] border-b border-slate-200">亚马逊漏斗诊断与流量操作建议</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
                    {processedSqpList.slice(0, sqpLimit).map((r, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/65 transition-colors">
                        <td 
                          className="p-3 sticky left-0 bg-white font-semibold border-r border-slate-100 text-slate-800 group-hover:bg-slate-50 truncate"
                          style={{ width: `${firstColWidth}px`, minWidth: `${firstColWidth}px`, maxWidth: `${firstColWidth}px` }}
                          title={r.kw}
                        >
                          {r.kw}
                        </td>
                        <td className="p-3 text-right font-mono text-[11px]">{r.qc.toLocaleString()}</td>
                        <td className="p-3 text-right font-mono text-[11px] font-semibold">{r.ord}</td>
                        <td className="p-3 text-right font-mono text-[11px]">{r.clk}</td>
                        <td className="p-3 text-right font-mono text-[11px] text-slate-500">{r.imp}</td>
                        <td className="p-3 text-center font-mono text-[11px] font-medium text-slate-800">{(r.buyShare * 100).toFixed(2)}%</td>
                        <td className="p-3 text-center font-mono text-[11px] text-slate-600">{(r.clickShare * 100).toFixed(2)}%</td>
                        <td className="p-3 text-center font-mono text-[11px] text-slate-500">{(r.impShare * 100).toFixed(2)}%</td>
                        <td className="p-3 text-center font-mono text-slate-500">{r.mp}</td>
                        <td className="p-3 text-center font-mono font-medium text-slate-800">{r.ap}</td>
                        <td className="p-3 text-right font-mono text-[11px] text-slate-500">{(r.marketCTR * 100).toFixed(2)}%</td>
                        <td className="p-3 text-right font-mono text-[11px] font-semibold text-emerald-700">{(r.asinCTR * 100).toFixed(2)}%</td>
                        <td className="p-3 text-right font-mono text-[11px] text-slate-500">{(r.marketCVR * 100).toFixed(2)}%</td>
                        <td className="p-3 text-right font-mono text-[11px] font-semibold text-slate-800">{(r.asinCVR * 100).toFixed(2)}%</td>
                        <td className={`p-3 text-center font-mono font-semibold ${r.clickImpRatio >= 1.15 ? 'text-emerald-600' : r.clickImpRatio < 0.85 ? 'text-red-500' : 'text-slate-600'}`}>
                          {r.clickImpRatio.toFixed(2)}x
                        </td>
                        <td className={`p-3 text-center font-mono font-semibold ${r.buyClickRatio >= 1.15 ? 'text-emerald-600' : r.buyClickRatio < 0.85 ? 'text-red-500' : 'text-slate-600'}`}>
                          {r.buyClickRatio.toFixed(2)}x
                        </td>
                        <td className="p-3 text-center w-[110px] min-w-[110px] whitespace-nowrap">
                          {(() => {
                            const bi = r.buyClickRatio;
                            const ci = r.clickImpRatio;
                            if (ci >= 1.0 && bi >= 1.0) {
                              return <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800 border border-purple-200">🛡️ 品牌防御</span>;
                            } else if (ci < 1.0 && bi >= 1.0) {
                              return <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">🎯 高转化收割</span>;
                            } else if (ci >= 1.0 && bi < 1.0) {
                              return <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-200">🧭 拓荒流量</span>;
                            } else {
                              return <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-800 border border-red-200">💨 无效空转</span>;
                            }
                          })()}
                        </td>
                        <td className="p-3 text-center w-[120px] min-w-[120px] whitespace-nowrap">
                          <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${r.convClass}`}>
                            {r.convTag}
                          </span>
                        </td>
                        <td className="p-3 min-w-[280px]">
                          <span 
                            title={r.advice}
                            className={`block max-w-[480px] truncate px-2.5 py-0.5 rounded text-[11px] font-normal select-text ${
                              r.adviceColor === 'badge-green' ? 'bg-emerald-50 text-emerald-800 border border-emerald-100' :
                              r.adviceColor === 'badge-red' ? 'bg-red-50 text-red-800 border border-red-100' :
                              r.adviceColor === 'badge-yellow' ? 'bg-amber-50 text-amber-800 border border-amber-100' :
                              'bg-slate-50 text-slate-700 border border-slate-200'
                            }`}
                          >
                            {r.advice}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {sqpTotals && (
                    <tfoot className="sticky bottom-0 z-20 shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
                      <tr className="font-bold border-t-2 border-slate-300 text-slate-900 bg-slate-100">
                        <td 
                          className="p-3 bg-slate-100 font-extrabold border-r border-slate-200 text-slate-950 truncate"
                          style={{ width: `${firstColWidth}px`, minWidth: `${firstColWidth}px`, maxWidth: `${firstColWidth}px`, position: 'sticky', bottom: 0, left: 0, zIndex: 30 }}
                          title="数据总和"
                        >
                          数据总和 (已贴底)
                        </td>
                        <td className="p-3 text-right bg-slate-100 font-mono text-[11px] font-extrabold" style={{ position: 'sticky', bottom: 0 }}>{sqpTotals.qc.toLocaleString()}</td>
                        <td className="p-3 text-right bg-slate-100 font-mono text-[11px] font-extrabold text-blue-700" style={{ position: 'sticky', bottom: 0 }}>{sqpTotals.ord.toLocaleString()}</td>
                        <td className="p-3 text-right bg-slate-100 font-mono text-[11px] font-extrabold" style={{ position: 'sticky', bottom: 0 }}>{sqpTotals.clk.toLocaleString()}</td>
                        <td className="p-3 text-right bg-slate-100 font-mono text-[11px] text-slate-605 font-extrabold" style={{ position: 'sticky', bottom: 0 }}>{sqpTotals.imp.toLocaleString()}</td>
                        <td className="p-3 text-center bg-slate-100 font-mono text-[11px] font-extrabold" style={{ position: 'sticky', bottom: 0 }}>{(sqpTotals.buyShare * 100).toFixed(2)}%</td>
                        <td className="p-3 text-center bg-slate-100 font-mono text-[11px] font-extrabold" style={{ position: 'sticky', bottom: 0 }}>{(sqpTotals.clickShare * 100).toFixed(2)}%</td>
                        <td className="p-3 text-center bg-slate-100 font-mono text-[11px] font-extrabold" style={{ position: 'sticky', bottom: 0 }}>{(sqpTotals.impShare * 100).toFixed(2)}%</td>
                        <td className="p-3 text-center bg-slate-100 font-mono text-[11px]" style={{ position: 'sticky', bottom: 0 }}>
                          ${sqpTotals.marketPriceAvg > 0 ? sqpTotals.marketPriceAvg.toFixed(2) : '—'}
                        </td>
                        <td className="p-3 text-center bg-slate-100 font-mono text-[11px]" style={{ position: 'sticky', bottom: 0 }}>
                          ${sqpTotals.asinPriceAvg > 0 ? sqpTotals.asinPriceAvg.toFixed(2) : '—'}
                        </td>
                        <td className="p-3 text-right bg-slate-100 font-mono text-[11px] font-extrabold text-slate-605" style={{ position: 'sticky', bottom: 0 }}>{(sqpTotals.marketCTR * 100).toFixed(2)}%</td>
                        <td className="p-3 text-right bg-slate-100 font-mono text-[11px] font-extrabold text-emerald-700" style={{ position: 'sticky', bottom: 0 }}>{(sqpTotals.asinCTR * 100).toFixed(2)}%</td>
                        <td className="p-3 text-right bg-slate-100 font-mono text-[11px] font-extrabold text-slate-605" style={{ position: 'sticky', bottom: 0 }}>{(sqpTotals.marketCVR * 100).toFixed(2)}%</td>
                        <td className="p-3 text-right bg-slate-100 font-mono text-[11px] font-extrabold text-slate-905" style={{ position: 'sticky', bottom: 0 }}>{(sqpTotals.asinCVR * 100).toFixed(2)}%</td>
                        <td className="p-3 text-center bg-slate-100 font-mono font-extrabold text-slate-800" style={{ position: 'sticky', bottom: 0 }}>{sqpTotals.clickImpRatio.toFixed(2)}x</td>
                        <td className="p-3 text-center bg-slate-100 font-mono font-extrabold text-slate-800" style={{ position: 'sticky', bottom: 0 }}>{sqpTotals.buyClickRatio.toFixed(2)}x</td>
                        <td className="p-3 text-center bg-slate-100 text-[10px] font-bold text-slate-500" style={{ position: 'sticky', bottom: 0 }}>汇总均值</td>
                        <td className="p-3 text-center bg-slate-100 text-[10px] font-bold text-slate-500" style={{ position: 'sticky', bottom: 0 }}>—</td>
                        <td className="p-3 text-left bg-slate-100 font-semibold text-slate-600 text-[11px]" style={{ position: 'sticky', bottom: 0 }}>已贴底校验</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>

              {processedSqpList.length > sqpLimit && (
                <div className="text-center pt-2">
                  <button
                    onClick={() => setSqpLimit(prev => prev + 100)}
                    className="px-4 py-2 border border-slate-200 shadow-2xs hover:bg-slate-50 hover:border-slate-350 text-xs text-blue-600 font-semibold rounded-lg transition-all inline-flex items-center gap-1 cursor-pointer"
                  >
                    <ChevronDown className="w-4 h-4" /> 展开加载更多大盘词数据 ({processedSqpList.length - sqpLimit}条未承载)
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : subTab === 'stems' ? (
            /* New Stems Aggregation Panel */
            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-5 shadow-sm">
              {/* Intro Header */}
              <div className="bg-gradient-to-r from-blue-50/70 to-indigo-50/30 p-4.5 rounded-xl border border-blue-105/70 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1">
                  <h4 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-blue-600 animate-pulse" /> 
                    大盘 / 本品 ASIN：双端词意段深度聚合透视 (Word Stems Aggregator)
                  </h4>
                  <p className="text-xs text-slate-600 leading-relaxed max-w-4xl">
                    本拆分聚合分析模块将离散的关键词细化为语义级的单词/并词词根。对比<b>大盘在特定词根下的买家供需特征 (QC/TC/TO/CVR)</b> 与 <b>本ASIN在此类语义段上的获量占有率 (曝光/点击/购买占有、本品CVR)</b>，可以极其快速地探明高商业高成交的「强转化」黄金词根、低渗透蓝海阵地，提供直接长效的亚马逊主图与竞价卡位决策建议。
                  </p>
                </div>
                <button
                  onClick={() => exportSqpStemsXlsx(processedStemsList)}
                  disabled={processedStemsList.length === 0}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-100 disabled:text-slate-400 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-sm self-start md:self-auto"
                >
                  <Download className="w-4 h-4" /> 导出聚合 Excel (.xlsx)
                </button>
              </div>

              {/* Configurations & Sliders */}
              <div className="bg-slate-50/50 rounded-xl p-4 border border-slate-150 grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                {/* Level selection */}
                <div className="md:col-span-3 space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5 text-blue-500 animate-spin-pulse" />
                     词段拆分层级 (Gram Selection)
                  </label>
                  <div className="flex gap-1 bg-white p-0.5 rounded-lg border border-slate-205">
                    {[
                      { id: '1-word', label: '1词' },
                      { id: '2-word', label: '2词并接' },
                      { id: '3-word', label: '3词长尾' },
                      { id: 'all', label: '混合' }
                    ].map(opt => (
                      <button
                        key={opt.id}
                        onClick={() => {
                          setStemType(opt.id as any);
                          setExpandedStem(null);
                        }}
                        className={`flex-1 py-1 px-1.5 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                          stemType === opt.id ? 'bg-slate-900 text-white shadow-2xs' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Ignore stop words and min frequency */}
                <div className="md:col-span-4 flex gap-4 items-center pl-0 md:pl-2">
                  <div className="space-y-1">
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">忽略连接虚词</span>
                    <label className="relative inline-flex items-center cursor-pointer select-none">
                      <input 
                        type="checkbox" 
                        checked={hideStopWords}
                        onChange={(e) => {
                          setHideStopWords(e.target.checked);
                          setExpandedStem(null);
                        }}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-slate-250 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-slate-900"></div>
                      <span className="ml-2 text-xs font-semibold text-slate-600">忽略 of 与 and 等</span>
                    </label>
                  </div>

                  <div className="space-y-1 flex-1 pl-4">
                    <div className="flex justify-between items-center text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                      <span>最低原词数频次</span>
                      <span className="text-blue-600 font-mono font-bold text-xs">{minFreq} 组起</span>
                    </div>
                    <input 
                      type="range" 
                      min="1" 
                      max="5" 
                      value={minFreq}
                      onChange={(e) => {
                        setMinFreq(parseInt(e.target.value));
                        setExpandedStem(null);
                      }}
                      className="w-full accent-slate-900 cursor-pointer"
                    />
                  </div>
                </div>

                {/* Keyword filter search */}
                <div className="md:col-span-5 space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">双端词根及包含词检索</label>
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      placeholder="快速检索特定属性、动作、品类词根..."
                      value={stemSearchQuery}
                      onChange={(e) => setStemSearchQuery(e.target.value)}
                      className="pl-9 pr-3 py-2 border border-slate-205 rounded-lg text-xs w-full focus:outline-none focus:border-blue-500 text-slate-700 bg-white shadow-3xs"
                    />
                  </div>
                </div>
              </div>

              {/* Role filtering chips */}
              <div className="flex flex-wrap items-center gap-1.5 pt-1 border-b border-slate-100 pb-3">
                <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1 uppercase tracking-wider mr-2">
                  <Filter className="w-3 h-3" /> 运营诊断定位:
                </span>
                <button
                  onClick={() => setSelectedStemRole(null)}
                  className={`py-1 px-3 rounded-full text-xs font-semibold scroll-smooth transition-all cursor-pointer ${
                    selectedStemRole === null ? 'bg-slate-900 text-white' : 'bg-slate-100 hover:bg-slate-150 text-slate-650'
                  }`}
                >
                  展现全部 ({rawStemsList.length} 词根)
                </button>
                {[
                  { tag: '强转化核心词根', emoji: '🟢' },
                  { tag: '黄金市占霸盘词根', emoji: '👑' },
                  { tag: '转化失焦/空耗预警', emoji: '🔴' },
                  { tag: '蓝海增量富矿词根', emoji: '💡' },
                  { tag: '点击率瓶颈词根', emoji: '⚠️' },
                  { tag: '均衡常规词群', emoji: '⚖%' }
                ].map(roleItem => {
                  const count = rawStemsList.filter(s => s.role.includes(roleItem.tag)).length;
                  if (count === 0 && roleItem.tag !== '均衡常规词群') return null;
                  return (
                    <button
                      key={roleItem.tag}
                      onClick={() => setSelectedStemRole(selectedStemRole === roleItem.tag ? null : roleItem.tag)}
                      className={`py-1 px-3 rounded-full text-[11px] font-semibold transition-all flex items-center gap-1 cursor-pointer ${
                        selectedStemRole === roleItem.tag 
                          ? 'bg-blue-600 text-white font-bold shadow-2xs' 
                          : 'bg-slate-100 hover:bg-slate-155 text-slate-600'
                      }`}
                    >
                      <span>{roleItem.emoji}</span>
                      <span>{roleItem.tag} ({count})</span>
                    </button>
                  );
                })}
              </div>

              {/* Collapsed keyword drawer box details (穿透明细) */}
              {expandedStem && (
                <div className="bg-sky-50/55 border border-sky-150 p-4.5 rounded-xl text-xs space-y-3 shadow-3xs animate-fade-in relative">
                  <button
                    onClick={() => setExpandedStem(null)}
                    className="absolute right-3.5 top-3.5 text-[10px] bg-white text-slate-650 px-2 py-0.5 rounded border border-slate-300 hover:bg-slate-100 font-bold transition-all cursor-pointer shadow-3xs"
                  >
                    ✕ 收起下级原始词
                  </button>
                  <div className="flex items-center gap-2">
                    <span className="p-1.5 bg-sky-100 text-sky-600 rounded-lg font-bold">🧬</span>
                    <div>
                      <p className="font-bold text-slate-800 text-[12px]">
                        词根「<span className="font-mono text-sky-600 font-black uppercase text-[12.5px]">{expandedStem}</span>」涵盖穿透原始长尾词大盘明细
                      </p>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        本期中包含此核心词根的 {sqpRows.filter(r => r.kw.toLowerCase().includes(expandedStem)).length} 个亚马逊离散长尾原词特征如下：
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 max-h-48 overflow-y-auto custom-scrollbar pt-1 pr-1">
                    {sqpRows
                      .filter(r => r.kw.toLowerCase().includes(expandedStem))
                      .sort((a,b) => b.ord - a.ord || b.qc - a.qc)
                      .map(r => (
                        <div key={r.kw} className="bg-white border border-slate-150 p-3 rounded-lg flex flex-col justify-between hover:border-slate-300 transition-all shadow-3xs hover:scale-[1.01]">
                          <span className="font-bold text-slate-800 truncate block text-[11px]" title={r.kw}>{r.kw}</span>
                          <div className="mt-2 flex justify-between items-center text-[10px] font-mono border-t border-slate-50 pt-1.5">
                            <span className="text-slate-500 text-[10px]">大盘Qc: {r.qc.toLocaleString()}</span>
                            <span className="text-blue-600 font-bold text-[10px]">本品销量: {r.ord} 单</span>
                          </div>
                          <div className="mt-1 flex justify-between items-center text-[9px] text-slate-400">
                            <span>曝光: {r.imp.toLocaleString()}</span>
                            <span>点击: {r.clk.toLocaleString()}</span>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Main table */}
              <div className="table-wrapper border border-slate-150 rounded-lg overflow-auto max-h-[460px] custom-scrollbar">
                <table className="relative w-full border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 text-[10.5px] font-bold sticky top-0 z-20 shadow-xs">
                      <th 
                        className="text-left p-3 cursor-pointer select-none sticky left-0 z-30 bg-slate-50 border-r border-slate-150 shadow-r-xs"
                        onClick={() => handleStemSort('stem')}
                        style={{ width: '200px', minWidth: '200px' }}
                      >
                        词根短词 / 拆分层级 {stemSortState.key === 'stem' ? (stemSortState.dir === 'asc' ? '▲' : '▼') : '↕'}
                      </th>
                      <th className="text-right p-3 cursor-pointer select-none" onClick={() => handleStemSort('count')}>原词关联量</th>
                      <th className="text-right p-3 cursor-pointer select-none" onClick={() => handleStemSort('totalQc')}>大盘总搜 qc</th>
                      <th className="text-right p-3 cursor-pointer select-none" onClick={() => handleStemSort('totalMarketClk')}>大盘总点击(TC)</th>
                      <th className="text-right p-3 cursor-pointer select-none" onClick={() => handleStemSort('totalMarketOrd')}>大盘总购买(TO)</th>
                      <th className="text-right p-3 cursor-pointer select-none font-semibold text-slate-600" onClick={() => handleStemSort('marketCvr')}>大盘平均 CVR</th>
                      <th className="text-right p-3 cursor-pointer select-none" onClick={() => handleStemSort('totalAsinImp')}>本ASIN曝光</th>
                      <th className="text-right p-3 cursor-pointer select-none" onClick={() => handleStemSort('totalAsinClk')}>本ASIN点击</th>
                      <th className="text-right p-3 cursor-pointer select-none" onClick={() => handleStemSort('totalAsinOrd')}>本ASIN购买</th>
                      <th className="text-right p-3 cursor-pointer select-none text-emerald-705" onClick={() => handleStemSort('asinCvr')}>本ASIN CVR</th>
                      <th className="text-center p-3 cursor-pointer select-none" onClick={() => handleStemSort('clickShare')}>点击占有率</th>
                      <th className="text-center p-3 cursor-pointer select-none text-blue-700 animate-pulse" onClick={() => handleStemSort('buyShare')}>购买占有率 (核心)</th>
                      <th className="text-center p-3 border-l border-slate-100" style={{ minWidth: '130px' }}>运营诊断打标</th>
                      <th className="text-left p-3" style={{ minWidth: '280px' }}>大盘/ASIN对冲穿透专案流量优化深度建议</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs text-slate-700 bg-white">
                    {processedStemsList.map((item, idx) => {
                      const isExpanded = expandedStem === item.stem;
                      return (
                        <tr key={idx} className={`hover:bg-slate-50/65 transition-colors ${isExpanded ? 'bg-sky-50/15' : ''}`}>
                          <td 
                            className="p-3 font-bold sticky left-0 bg-white font-mono text-slate-800 border-r border-slate-100 flex items-center gap-2 truncate z-10 shadow-r-3xs"
                            style={{ width: '200px', minWidth: '200px', maxWidth: '200px' }}
                            title="点击在此处穿透看关联词明细"
                          >
                            <button 
                              onClick={() => setExpandedStem(isExpanded ? null : item.stem)}
                              className={`px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 shadow-3xs cursor-pointer ${
                                item.type === '1-word' ? 'bg-amber-100 text-amber-850' : item.type === '2-word' ? 'bg-emerald-100 text-emerald-850 font-extrabold' : 'bg-indigo-150 text-indigo-850'
                              }`}
                            >
                              {item.type === '1-word' ? '1词' : item.type === '2-word' ? '2词' : '3词'}
                            </button>
                            <span 
                              onClick={() => setExpandedStem(isExpanded ? null : item.stem)}
                              className="truncate hover:text-blue-600 transition-all cursor-pointer underline decoration-dotted font-extrabold text-[12px] uppercase"
                            >
                              {item.stem}
                            </span>
                          </td>
                          <td className="p-3 text-right font-mono text-[11px] text-slate-500 font-bold">{item.count}组词</td>
                          <td className="p-3 text-right font-mono text-[11px] font-semibold">{item.totalQc.toLocaleString()}</td>
                          <td className="p-3 text-right font-mono text-[11px] text-slate-500">{item.totalMarketClk.toLocaleString()}</td>
                          <td className="p-3 text-right font-mono text-[11px] font-bold text-slate-800">{item.totalMarketOrd.toLocaleString()}</td>
                          <td className="p-3 text-right font-mono text-[11px] text-slate-500 font-medium">{(item.marketCvr * 100).toFixed(2)}%</td>
                          <td className="p-3 text-right font-mono text-[11px] text-slate-450">{item.totalAsinImp.toLocaleString()}</td>
                          <td className="p-3 text-right font-mono text-[11px] text-slate-450">{item.totalAsinClk.toLocaleString()}</td>
                          <td className="p-3 text-right font-mono text-[11px] font-bold text-emerald-600">{item.totalAsinOrd}</td>
                          <td className="p-3 text-right font-mono text-[11px] font-bold text-slate-850">{(item.asinCvr * 100).toFixed(2)}%</td>
                          <td className="p-3 text-center font-mono text-[11px] font-medium text-slate-650">{(item.clickShare * 100).toFixed(2)}%</td>
                          <td className="p-3 text-center font-mono text-[11px] font-extrabold text-blue-650">{(item.buyShare * 100).toFixed(2)}%</td>
                          <td className="p-3 text-center border-l border-slate-50">
                            <span className={`inline-block px-2 py-0.5 rounded text-[9.5px] font-extrabold whitespace-nowrap leading-none ${item.roleClass}`}>
                              {item.role}
                            </span>
                          </td>
                          <td className="p-3 min-w-[280px]">
                            <span 
                              title={item.advice}
                              className={`block max-w-[480px] truncate px-2.5 py-1 rounded text-[11px] font-medium leading-relaxed select-text ${
                                item.role.includes('强转化') || item.role.includes('黄金') || item.role.includes('核心') ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' :
                                item.role.includes('预警') || item.role.includes('失焦') ? 'bg-red-50 text-red-800 border border-red-200' :
                                item.role.includes('瓶颈') ? 'bg-amber-50 text-amber-800 border border-amber-200' :
                                item.role.includes('蓝海') ? 'bg-sky-55/15 text-sky-850 border border-sky-350/20' :
                                'bg-slate-50 text-slate-700 border border-slate-200'
                              }`}
                            >
                              {item.advice}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                    {processedStemsList.length === 0 && (
                      <tr>
                        <td colSpan={14} className="text-center py-12 text-slate-400 font-medium font-sans">
                          ⚠️ 按照当前的拆解频数或检索词未聚合出符合条件之词根组件。请重设上方条件选项。
                        </td>
                      </tr>
                    )}
                  </tbody>
                  {stemTotals && (
                    <tfoot className="sticky bottom-0 z-20 shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
                      <tr className="font-bold border-t-2 border-slate-300 text-slate-900 bg-slate-100">
                        <td 
                          className="p-3 bg-slate-100 font-extrabold border-r border-slate-200 text-slate-955 truncate"
                          style={{ width: '200px', minWidth: '200px', maxWidth: '200px', position: 'sticky', bottom: 0, left: 0, zIndex: 30 }}
                          title="词根聚合汇总"
                        >
                          词根汇总 (已贴底)
                        </td>
                        <td className="p-3 text-right bg-slate-100 font-mono text-[11px] font-extrabold" style={{ position: 'sticky', bottom: 0 }}>{stemTotals.originalWordsCount}组词</td>
                        <td className="p-3 text-right bg-slate-100 font-mono text-[11px] font-semibold" style={{ position: 'sticky', bottom: 0 }}>{stemTotals.totalQc.toLocaleString()}</td>
                        <td className="p-3 text-right bg-slate-100 font-mono text-[11px]" style={{ position: 'sticky', bottom: 0 }}>{stemTotals.totalMarketClk.toLocaleString()}</td>
                        <td className="p-3 text-right bg-slate-100 font-mono text-[11px] font-bold text-slate-800" style={{ position: 'sticky', bottom: 0 }}>{stemTotals.totalMarketOrd.toLocaleString()}</td>
                        <td className="p-3 text-right bg-slate-100 font-mono text-[11px] font-semibold text-slate-600" style={{ position: 'sticky', bottom: 0 }}>{(stemTotals.marketCvr * 100).toFixed(2)}%</td>
                        <td className="p-3 text-right bg-slate-100 font-mono text-[11px]" style={{ position: 'sticky', bottom: 0 }}>{stemTotals.totalAsinImp.toLocaleString()}</td>
                        <td className="p-3 text-right bg-slate-100 font-mono text-[11px]" style={{ position: 'sticky', bottom: 0 }}>{stemTotals.totalAsinClk.toLocaleString()}</td>
                        <td className="p-3 text-right bg-slate-100 font-mono text-[11px] font-bold text-blue-700" style={{ position: 'sticky', bottom: 0 }}>{stemTotals.totalAsinOrd.toLocaleString()}</td>
                        <td className="p-3 text-right bg-slate-100 font-mono text-[11px] font-bold text-slate-900" style={{ position: 'sticky', bottom: 0 }}>{(stemTotals.asinCvr * 100).toFixed(2)}%</td>
                        <td className="p-3 text-center bg-slate-100 font-mono text-[11px] font-semibold text-slate-600" style={{ position: 'sticky', bottom: 0 }}>{(stemTotals.clickShare * 100).toFixed(2)}%</td>
                        <td className="p-3 text-center bg-slate-100 font-mono text-[11px] font-extrabold text-blue-700" style={{ position: 'sticky', bottom: 0 }}>{(stemTotals.buyShare * 100).toFixed(2)}%</td>
                        <td className="p-3 text-center bg-slate-100 text-[10px] font-bold text-slate-500 border-l border-slate-100" style={{ position: 'sticky', bottom: 0 }}>打标总括</td>
                        <td className="p-3 text-left bg-slate-100 font-semibold text-slate-600 text-[11px]" style={{ position: 'sticky', bottom: 0 }}>已贴底校验</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          ) : (
            /* Annual Trend Aggregation Panel */
            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-6 shadow-sm">
              {/* Header */}
              <div className="bg-gradient-to-r from-emerald-50/20 to-teal-50/5 p-4.5 rounded-xl border border-emerald-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1">
                  <h4 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                    <Calendar className="w-4 h-4 text-emerald-600 animate-pulse" /> 
                    1-12月份年度检索查询绩效汇总走势分析 (Annual Trend Analyzer)
                  </h4>
                  <p className="text-xs text-slate-500 leading-relaxed font-medium">
                    通过导入多至12个月的SQP数据包，智能汇总本品与大盘的年度搜索需求量、曝光点击流量及购买转化率的全局走势曲线。
                  </p>
                </div>
                <div>
                  <label 
                    htmlFor="batch-monthly-upload" 
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs shadow-xs hover:shadow-sm cursor-pointer transition-all inline-flex items-center gap-1.5"
                  >
                    <RefreshCw className="w-3.5 h-3.5 animate-spin-slow" />
                    ⚡ 智能批量导入月度报告
                  </label>
                  <input
                    type="file"
                    multiple
                    accept=".csv,.xlsx,.xls"
                    onChange={(e) => e.target.files && handleBatchMonthlyUpload(e.target.files)}
                    className="hidden"
                    id="batch-monthly-upload"
                  />
                </div>
              </div>

              {/* Status Indicator */}
              {monthlyStatus && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono text-slate-600 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                  <span>{monthlyStatus}</span>
                </div>
              )}

              {/* 12 Months Slots Grid */}
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <h5 className="text-xs font-bold text-slate-700 uppercase tracking-wider">月度数据卡槽 (1-12月上传状态)</h5>
                  <button
                    onClick={() => {
                      if (window.confirm('确定要清空所有已导入的月度数据吗？')) {
                        setMonthlySqpData({});
                        setMonthlyStatus('🧹 已清空所有月份数据。');
                      }
                    }}
                    className="text-xs text-red-500 hover:text-red-700 font-bold transition-all hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> 清空全部月度报告
                  </button>
                </div>
                
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                  {Array.from({ length: 12 }, (_, i) => i + 1).map(m => {
                    const data = monthlySqpData[m];
                    return (
                      <div 
                        key={m} 
                        className={`border rounded-lg p-3 flex flex-col justify-between min-h-[96px] transition-all relative group ${
                          data 
                            ? 'border-emerald-250 bg-emerald-50/10 shadow-3xs' 
                            : 'border-dashed border-slate-200 bg-slate-50/50 hover:bg-slate-50 hover:border-slate-350'
                        }`}
                      >
                        <div className="flex justify-between items-start gap-1">
                          <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded ${
                            data ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
                          }`}>
                            {m < 10 ? `0${m}` : m}月
                          </span>
                          {data && (
                            <button
                              onClick={() => {
                                setMonthlySqpData(prev => {
                                  const copy = { ...prev };
                                  delete copy[m];
                                  return copy;
                                });
                                setMonthlyStatus(`🧹 已移除 ${m}月份 数据`);
                              }}
                              className="text-slate-400 hover:text-red-600 p-0.5 rounded hover:bg-white cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                              title="移除此月度报告"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>

                        {data ? (
                          <div className="mt-2 space-y-0.5">
                            <p className="text-[10px] text-slate-700 font-medium truncate max-w-full" title={data.fileName}>
                              {data.fileName}
                            </p>
                            <p className="text-[9px] text-slate-400 font-mono">
                              已导入 {data.rowCount} 行
                            </p>
                          </div>
                        ) : (
                          <div className="mt-2">
                            <label 
                              htmlFor={`month-upload-${m}`}
                              className="text-[10px] text-blue-600 hover:text-blue-800 font-bold cursor-pointer hover:underline block"
                            >
                              点击上传报告
                            </label>
                            <input
                              type="file"
                              accept=".csv,.xlsx,.xls"
                              onChange={(e) => e.target.files?.[0] && parseMonthlyFile(e.target.files[0], m)}
                              className="hidden"
                              id={`month-upload-${m}`}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Data Dashboard and Charts once files exist */}
              {Object.keys(monthlySqpData).length > 0 ? (
                <div className="space-y-6 pt-4 border-t border-slate-100">
                  {/* Select Control and Filters */}
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-4 shadow-3xs">
                    {/* Mode Toggle Bar */}
                    <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200/80">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-700">🎯 分析维度模式：</span>
                        <div className="inline-flex bg-slate-200/80 p-1 rounded-lg">
                          <button
                            onClick={() => setAnnualViewMode('keyword')}
                            className={`px-3 py-1.5 rounded-md text-xs font-extrabold transition-all cursor-pointer flex items-center gap-1.5 ${
                              annualViewMode === 'keyword'
                                ? 'bg-white text-emerald-800 shadow-xs'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            <span>📌 关键词 & 预设前20词汇总</span>
                          </button>
                          <button
                            onClick={() => {
                              setAnnualViewMode('root');
                              if (!selectedAnnualRoot && annualTopRoots.length > 0) {
                                setSelectedAnnualRoot(annualTopRoots[0].root);
                              }
                            }}
                            className={`px-3 py-1.5 rounded-md text-xs font-extrabold transition-all cursor-pointer flex items-center gap-1.5 ${
                              annualViewMode === 'root'
                                ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-xs'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            <span>🌱 新增：年度词根趋势分析</span>
                            <span className="bg-red-500 text-white text-[9px] px-1.5 py-0.2 rounded-full font-mono">NEW</span>
                          </button>
                        </div>
                      </div>
                      <p className="text-[11px] text-slate-500 font-medium">
                        {annualViewMode === 'keyword'
                          ? '支持查看单词或大盘/本品前20词的总聚合指标趋势'
                          : '支持对核心词根（如属性、材质、功能词）包含的所有关键词进行全年月度趋势聚合诊断'}
                      </p>
                    </div>

                    {annualViewMode === 'root' ? (
                      <div className="space-y-4">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-3 border-b border-slate-200/60">
                          <div className="space-y-1">
                            <h4 className="text-xs font-bold text-amber-800 flex items-center gap-1.5 uppercase tracking-wider">
                              <Sparkles className="w-4 h-4 text-amber-600 animate-pulse" />
                              年度词根深度聚合诊断 (Root Word Trend Analyzer)
                            </h4>
                            <p className="text-[11px] text-slate-500">
                              自动扫描全年大盘中高频出现的词根。选择或输入任意词根，聚合观察含有该词根的所有关键词在1-12月的四大核心维度指标。
                            </p>
                          </div>
                          
                          <div className="flex flex-col sm:flex-row gap-2 shrink-0">
                            <div className="relative w-full sm:w-56">
                              <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-slate-400" />
                              <input
                                type="text"
                                placeholder="自定义输入任意词根..."
                                value={annualRootSearch}
                                onChange={(e) => setAnnualRootSearch(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && annualRootSearch.trim()) {
                                    setSelectedAnnualRoot(annualRootSearch.trim());
                                  }
                                }}
                                className="w-full pl-9 pr-3 py-2 border border-slate-250 rounded-lg text-xs font-medium focus:ring-2 focus:ring-amber-500 outline-hidden bg-white shadow-3xs"
                              />
                            </div>
                            <button
                              onClick={() => {
                                if (annualRootSearch.trim()) {
                                  setSelectedAnnualRoot(annualRootSearch.trim());
                                }
                              }}
                              className="px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg shadow-3xs cursor-pointer transition-all shrink-0"
                            >
                              分析词根
                            </button>
                            <select
                              value={selectedAnnualRoot}
                              onChange={(e) => setSelectedAnnualRoot(e.target.value)}
                              className="border border-slate-250 rounded-lg text-xs font-bold px-3 py-2 focus:ring-2 focus:ring-amber-500 outline-hidden bg-white min-w-[190px] shadow-3xs"
                            >
                              <option value="">-- 选择年度高频词根 --</option>
                              {annualTopRoots.slice(0, 100).map(item => (
                                <option key={item.root} value={item.root}>
                                  {item.root} (共{item.kwCount}词 · 搜索量:{item.totalQc.toLocaleString()})
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        {/* Top 24 High-Frequency Root Chips */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <p className="text-[11px] font-bold text-slate-700 flex items-center gap-1.5">
                              <span>🔥 全年大盘高频优选词根 (Top High-Frequency Roots)：</span>
                            </p>
                            <span className="text-[10px] text-slate-400">点击标签立即观察该词根对大盘搜索量/CVR/购买占比的驱动走势</span>
                          </div>
                          {annualTopRoots.length === 0 ? (
                            <p className="text-[11px] text-slate-400 italic">暂无足够数据提取词根</p>
                          ) : (
                            <div className="flex flex-wrap gap-1.5 max-h-[130px] overflow-y-auto pr-1">
                              {annualTopRoots.slice(0, 24).map(({ root, kwCount, totalQc }) => {
                                const isSelected = selectedAnnualRoot.toLowerCase() === root.toLowerCase();
                                return (
                                  <button
                                    key={`root-chip-${root}`}
                                    onClick={() => setSelectedAnnualRoot(root)}
                                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all text-left flex items-center gap-1.5 border cursor-pointer ${
                                      isSelected
                                        ? 'bg-gradient-to-r from-amber-600 to-orange-600 text-white border-amber-600 font-bold shadow-xs'
                                        : 'bg-white text-slate-700 border-slate-200 hover:bg-amber-50 hover:border-amber-300 hover:text-amber-900'
                                    }`}
                                  >
                                    <span className="font-semibold">{root}</span>
                                    <span className={`text-[9px] font-mono px-1.5 py-0.2 rounded ${isSelected ? 'bg-amber-800 text-amber-100' : 'bg-slate-100 text-slate-500'}`}>
                                      {kwCount}词
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-3 border-b border-slate-200/60">
                          <div className="space-y-1">
                            <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5 uppercase tracking-wider">
                              <Sliders className="w-4 h-4 text-emerald-600" />
                              关键词切换与检索 (Keyword Navigation)
                            </h4>
                            <p className="text-[11px] text-slate-500">
                              输入关键词进行实时过滤，或点击下方 Top 20 核心热词一键聚焦单个词的深度双轴趋势走势。
                            </p>
                          </div>
                          
                          <div className="flex flex-col sm:flex-row gap-2 shrink-0">
                            <div className="relative w-full sm:w-64">
                              <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-slate-400" />
                              <input
                                type="text"
                                placeholder="搜索/过滤关键词..."
                                value={annualKwSearch}
                                onChange={(e) => setAnnualKwSearch(e.target.value)}
                                className="w-full pl-9 pr-3 py-2 border border-slate-250 rounded-lg text-xs font-medium focus:ring-2 focus:ring-emerald-500 outline-hidden bg-white shadow-3xs"
                              />
                            </div>
                            <select
                              value={selectedAnnualKw}
                              onChange={(e) => setSelectedAnnualKw(e.target.value)}
                              className="border border-slate-250 rounded-lg text-xs font-bold px-3 py-2 focus:ring-2 focus:ring-emerald-500 outline-hidden bg-white min-w-[200px] shadow-3xs"
                            >
                              <option value="__TOP20_ASIN__">🏆 本品 Top 20 关键词汇总 (前20词搜索/CVR/本品CVR)</option>
                              <option value="__TOP20_MARKET__">👑 大盘 Top 20 关键词汇总 (前20词搜索/CVR/本品CVR)</option>
                              <option value="__ALL__">📦 全部搜索查询综合汇总 (Overall Summary)</option>
                              {filteredAnnualKws.slice(0, 200).map(kw => (
                                <option key={kw} value={kw}>{kw}</option>
                              ))}
                            </select>
                          </div>
                        </div>

                        {/* Top 20 Keywords Quick Selector Panel */}
                        <div className="space-y-3">
                          <p className="text-[11px] font-bold text-slate-600 flex items-center gap-1">
                            <Sparkles className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
                            👉 点击下方核心关键词，直接查看该词的【搜索量 & 转化率】双轴走势及月度表格明细：
                          </p>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                            {/* ASIN Top 20 */}
                            <div className="space-y-2 bg-white p-3 rounded-lg border border-slate-100">
                              <div className="flex items-center justify-between pb-1 border-b border-slate-100">
                                <div className="flex items-center gap-1.5">
                                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                                  <span className="text-[11px] font-bold text-slate-600">本品 ASIN 购买量前 20 词 (ASIN Orders)</span>
                                </div>
                                <button
                                  onClick={() => setSelectedAnnualKw('__TOP20_ASIN__')}
                                  className={`px-2 py-0.5 rounded text-[10px] font-extrabold transition-all cursor-pointer ${
                                    selectedAnnualKw === '__TOP20_ASIN__'
                                      ? 'bg-emerald-600 text-white shadow-3xs'
                                      : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                  }`}
                                >
                                  🏆 查看前20词总汇总 (大盘搜索/CVR/本品CVR)
                                </button>
                              </div>
                              {topAnnualKeywords.byAsin.length === 0 ? (
                                <p className="text-[11px] text-slate-400 italic">暂无本品购买数据</p>
                              ) : (
                                <div className="flex flex-wrap gap-1.5 max-h-[120px] overflow-y-auto pr-1">
                                  {topAnnualKeywords.byAsin.map(({ kw, totalAsinOrd }) => {
                                    const isSelected = selectedAnnualKw.toLowerCase() === kw.toLowerCase();
                                    return (
                                      <button
                                        key={`asin-selector-${kw}`}
                                        onClick={() => setSelectedAnnualKw(kw)}
                                        className={`px-2 py-1 rounded-md text-[11px] font-medium transition-all text-left flex items-center gap-1.5 border cursor-pointer ${
                                          isSelected
                                            ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white border-emerald-600 font-semibold shadow-xs'
                                            : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100 hover:text-slate-900'
                                        }`}
                                      >
                                        <span className="truncate max-w-[120px]" title={kw}>{kw}</span>
                                        <span className={`text-[9px] font-mono px-1 rounded ${isSelected ? 'bg-emerald-700 text-emerald-100' : 'bg-slate-200/70 text-slate-500'}`}>
                                          {totalAsinOrd}单
                                        </span>
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>

                            {/* Market Top 20 */}
                            <div className="space-y-2 bg-white p-3 rounded-lg border border-slate-100">
                              <div className="flex items-center justify-between pb-1 border-b border-slate-100">
                                <div className="flex items-center gap-1.5">
                                  <span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span>
                                  <span className="text-[11px] font-bold text-slate-600">大盘总购买量前 20 词 (Market Total Purchases)</span>
                                </div>
                                <button
                                  onClick={() => setSelectedAnnualKw('__TOP20_MARKET__')}
                                  className={`px-2 py-0.5 rounded text-[10px] font-extrabold transition-all cursor-pointer ${
                                    selectedAnnualKw === '__TOP20_MARKET__'
                                      ? 'bg-purple-600 text-white shadow-3xs'
                                      : 'bg-purple-50 text-purple-700 hover:bg-purple-100'
                                  }`}
                                >
                                  👑 查看前20词总汇总 (大盘搜索/CVR/本品CVR)
                                </button>
                              </div>
                              {topAnnualKeywords.byMarket.length === 0 ? (
                                <p className="text-[11px] text-slate-400 italic">暂无大盘购买数据</p>
                              ) : (
                                <div className="flex flex-wrap gap-1.5 max-h-[120px] overflow-y-auto pr-1">
                                  {topAnnualKeywords.byMarket.map(({ kw, totalMarketOrd }) => {
                                    const isSelected = selectedAnnualKw.toLowerCase() === kw.toLowerCase();
                                    return (
                                      <button
                                        key={`market-selector-${kw}`}
                                        onClick={() => setSelectedAnnualKw(kw)}
                                        className={`px-2 py-1 rounded-md text-[11px] font-medium transition-all text-left flex items-center gap-1.5 border cursor-pointer ${
                                          isSelected
                                            ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white border-emerald-600 font-semibold shadow-xs'
                                            : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100 hover:text-slate-900'
                                        }`}
                                      >
                                        <span className="truncate max-w-[120px]" title={kw}>{kw}</span>
                                        <span className={`text-[9px] font-mono px-1 rounded ${isSelected ? 'bg-emerald-700 text-emerald-100' : 'bg-slate-200/70 text-slate-500'}`}>
                                          {totalMarketOrd}单
                                        </span>
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  {/* HERO VIEW: Selected Keyword Dual Axis Dashboard */}
                  <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4 border-l-4 border-l-emerald-500">
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-3 border-b border-slate-100">
                      <div>
                        <h4 className="text-sm font-extrabold text-slate-800 flex flex-wrap items-center gap-2">
                          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 text-xs">🎯</span>
                          <span>{annualViewMode === 'root' ? '【年度词根趋势深度看板】:' : '【单个关键词趋势深度看板】:'}</span>
                          <span className="text-emerald-700 font-black text-xs md:text-sm px-2.5 py-1 bg-emerald-50 border border-emerald-200 rounded-md shadow-3xs max-w-full truncate">
                            {annualViewMode === 'root'
                              ? `🌱 词根 「${selectedAnnualRoot || (annualTopRoots[0]?.root || '未选择')}」 组合群体 (${activeRootMatchingKws.length}个词)`
                              : selectedAnnualKw === '__ALL__' ? '📦 全部关键词综合汇总 (All Keywords)' :
                                selectedAnnualKw === '__TOP20_ASIN__' ? '🏆 本品 Top 20 关键词汇总对比 (前20词大盘搜索/CVR/本品CVR)' :
                                selectedAnnualKw === '__TOP20_MARKET__' ? '👑 大盘 Top 20 关键词汇总对比 (前20词大盘搜索/CVR/本品CVR)' :
                                selectedAnnualKw}
                          </span>
                        </h4>
                        <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                          {annualViewMode === 'root'
                            ? '当前查看含有特定词根（如材质、功能、属性词）的全部关键词在 1-12月 的聚合趋势。图表支持查看：大盘搜索量 · 大盘 CVR · 本品 CVR · 本品购买占比 四大核心维度的全年走势。'
                            : '当前查看单个关键词或聚合汇总（如前20个关键词总汇总）的全年月度趋势。图表左轴代表搜索量，右轴代表转化率与本品购买占比；右侧表格展示详细月度指标。'}
                        </p>
                      </div>
                      
                      <button
                        onClick={annualViewMode === 'root' ? downloadRootTrendData : downloadTrendData}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs px-3 py-2 rounded-lg flex items-center gap-1.5 transition-all shadow-3xs shrink-0 cursor-pointer"
                        title="下载当前选中词根或 Top 20 词的完整月度趋势表格"
                      >
                        <FileSpreadsheet className="w-3.5 h-3.5" />
                        下载趋势数据
                      </button>
                    </div>

                    {/* Top 20 Aggregate & Keyword KPI Summary Toolbar */}
                    <div className="space-y-3">
                      {annualViewMode === 'root' ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-bold text-amber-700">⚡ 核心高频词根快捷聚焦：</span>
                          {annualTopRoots.slice(0, 6).map(({ root, kwCount }) => {
                            const isSelected = selectedAnnualRoot.toLowerCase() === root.toLowerCase();
                            return (
                              <button
                                key={`quick-root-${root}`}
                                onClick={() => setSelectedAnnualRoot(root)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition-all border cursor-pointer flex items-center gap-1.5 ${
                                  isSelected
                                    ? 'bg-amber-600 text-white border-amber-600 shadow-sm'
                                    : 'bg-amber-50 text-amber-900 border-amber-200 hover:bg-amber-100'
                                }`}
                              >
                                <span>🌱 {root} ({kwCount}词)</span>
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-bold text-slate-500">⚡ 快捷聚合视图：</span>
                          <button
                            onClick={() => setSelectedAnnualKw('__TOP20_ASIN__')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition-all border cursor-pointer flex items-center gap-1.5 ${
                              selectedAnnualKw === '__TOP20_ASIN__'
                                ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                                : 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                            }`}
                          >
                            🏆 前20个关键词总汇总（本品成交Top20）
                          </button>
                          <button
                            onClick={() => setSelectedAnnualKw('__TOP20_MARKET__')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition-all border cursor-pointer flex items-center gap-1.5 ${
                              selectedAnnualKw === '__TOP20_MARKET__'
                                ? 'bg-purple-600 text-white border-purple-600 shadow-sm'
                                : 'bg-purple-50 text-purple-800 border-purple-200 hover:bg-purple-100'
                            }`}
                          >
                            👑 前20个关键词总汇总（大盘成交Top20）
                          </button>
                          <button
                            onClick={() => setSelectedAnnualKw('__ALL__')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition-all border cursor-pointer ${
                              selectedAnnualKw === '__ALL__'
                                ? 'bg-slate-800 text-white border-slate-800 shadow-sm'
                                : 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200'
                            }`}
                          >
                            📦 全局所有词总汇总
                          </button>
                        </div>
                      )}

                      {/* 4 KPI Summary Cards for selected view */}
                      {(() => {
                        const activeMonths = annualChartData.filter(r => r.hasData);
                        const totalQc = annualChartData.reduce((sum, r) => sum + r.marketQc, 0);
                        const avgMarketCvr = activeMonths.length > 0
                          ? activeMonths.reduce((sum, r) => sum + r.marketCVR, 0) / activeMonths.length
                          : 0;
                        const avgAsinCvr = activeMonths.length > 0
                          ? activeMonths.reduce((sum, r) => sum + r.asinCVR, 0) / activeMonths.length
                          : 0;
                        const avgBuyShare = activeMonths.length > 0
                          ? activeMonths.reduce((sum, r) => sum + r.buyShare, 0) / activeMonths.length
                          : 0;

                        return (
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <div className="bg-blue-50/70 border border-blue-200 rounded-xl p-3">
                              <p className="text-[11px] font-bold text-blue-700 flex items-center justify-between">
                                <span>大盘总搜索量 (总计)</span>
                                <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 rounded">Search QC</span>
                              </p>
                              <p className="text-lg md:text-xl font-black text-blue-900 mt-1 font-mono">
                                {totalQc.toLocaleString()}
                              </p>
                              <p className="text-[10px] text-blue-600/80 mt-0.5">已导入 {activeMonths.length} 个月累计</p>
                            </div>

                            <div className="bg-purple-50/70 border border-purple-200 rounded-xl p-3">
                              <p className="text-[11px] font-bold text-purple-700 flex items-center justify-between">
                                <span>大盘 CVR (平均)</span>
                                <span className="text-[10px] px-1.5 py-0.5 bg-purple-100 rounded">Market CVR</span>
                              </p>
                              <p className="text-lg md:text-xl font-black text-purple-900 mt-1 font-mono">
                                {(avgMarketCvr * 100).toFixed(2)}%
                              </p>
                              <p className="text-[10px] text-purple-600/80 mt-0.5">全期各月大盘转化率均值</p>
                            </div>

                            <div className="bg-pink-50/70 border border-pink-200 rounded-xl p-3">
                              <p className="text-[11px] font-bold text-pink-700 flex items-center justify-between">
                                <span>本品 CVR (平均)</span>
                                <span className="text-[10px] px-1.5 py-0.5 bg-pink-100 rounded">ASIN CVR</span>
                              </p>
                              <p className="text-lg md:text-xl font-black text-pink-900 mt-1 font-mono">
                                {(avgAsinCvr * 100).toFixed(2)}%
                              </p>
                              <p className="text-[10px] text-pink-600/80 mt-0.5">全期各月本品转化率均值</p>
                            </div>

                            <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-3">
                              <p className="text-[11px] font-bold text-emerald-700 flex items-center justify-between">
                                <span>本品购买占比 (均值)</span>
                                <span className="text-[10px] px-1.5 py-0.5 bg-emerald-100 rounded">Buy Share</span>
                              </p>
                              <p className="text-lg md:text-xl font-black text-emerald-900 mt-1 font-mono">
                                {(avgBuyShare * 100).toFixed(2)}%
                              </p>
                              <p className="text-[10px] text-emerald-600/80 mt-0.5">全期购买占有率均值</p>
                            </div>
                          </div>
                        );
                      })()}

                      {annualViewMode === 'keyword' && (selectedAnnualKw === '__TOP20_ASIN__' || selectedAnnualKw === '__TOP20_MARKET__') && (
                        <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-xs text-slate-700">
                          <span className="font-bold text-slate-800">
                            📌 当前【{selectedAnnualKw === '__TOP20_ASIN__' ? '本品购买前 20 词' : '大盘购买前 20 词'}】汇总包含的核心关键词 ({
                              (selectedAnnualKw === '__TOP20_ASIN__' ? topAnnualKeywords.byAsin : topAnnualKeywords.byMarket).length
                            } 个)：
                          </span>
                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                            {(selectedAnnualKw === '__TOP20_ASIN__' ? topAnnualKeywords.byAsin : topAnnualKeywords.byMarket).map(({ kw }) => (
                              <button
                                key={kw}
                                onClick={() => setSelectedAnnualKw(kw)}
                                className="bg-white px-2 py-0.5 rounded border border-slate-300 text-[11px] font-medium text-slate-800 shadow-3xs hover:bg-emerald-50 hover:border-emerald-400 hover:text-emerald-800 cursor-pointer transition-all"
                                title="点击直接查看该单词的全年趋势"
                              >
                                {kw}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {annualViewMode === 'root' && activeRootMatchingKws.length > 0 && (
                        <div className="bg-amber-50/70 border border-amber-200 rounded-lg p-2.5 text-xs text-amber-900">
                          <span className="font-bold text-amber-900">
                            🌱 当前词根 「{selectedAnnualRoot || (annualTopRoots[0]?.root || '')}」 共匹配至以下 {activeRootMatchingKws.length} 个关键词（指标为这 {activeRootMatchingKws.length} 个词的所有月度聚合）：
                          </span>
                          <div className="flex flex-wrap gap-1.5 mt-1.5 max-h-[100px] overflow-y-auto pr-1">
                            {activeRootMatchingKws.map((item) => (
                              <button
                                key={`root-kw-tag-${item.kw}`}
                                onClick={() => {
                                  setAnnualViewMode('keyword');
                                  setSelectedAnnualKw(item.kw);
                                }}
                                className="bg-white px-2 py-0.5 rounded border border-amber-300 text-[11px] font-medium text-amber-900 shadow-3xs hover:bg-emerald-50 hover:border-emerald-400 hover:text-emerald-800 cursor-pointer transition-all"
                                title="点击直接切换至关键词视图并查看该词的全年趋势"
                              >
                                {item.kw}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                      {/* Left Block: Double Y-Axes Chart (7 Columns) */}
                      <div className="lg:col-span-7 border border-slate-100 bg-slate-50/20 rounded-xl p-4.5 space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                            <TrendingUp className="w-4 h-4 text-emerald-600" />
                            双纵坐标走势图 (Dual-Axis Chart)
                          </p>
                          <div className="flex flex-wrap items-center gap-2.5 text-[10px] text-slate-400">
                            <span className="flex items-center gap-1">
                              <span className="w-2.5 h-2.5 bg-blue-500 rounded-xs inline-block opacity-70"></span> 搜索量 (左轴)
                            </span>
                            <span className="flex items-center gap-1">
                              <span className="w-2.5 h-0.5 bg-[#8b5cf6] inline-block"></span> 大盘 CVR (右轴)
                            </span>
                            <span className="flex items-center gap-1">
                              <span className="w-2.5 h-0.5 bg-[#ec4899] inline-block"></span> 本品 CVR (右轴)
                            </span>
                          </div>
                        </div>

                        <div className="h-80 w-full text-[10px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={annualChartData} margin={{ top: 15, right: 10, left: -20, bottom: 5 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                              <XAxis dataKey="month" tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
                              <YAxis 
                                yAxisId="left" 
                                tickLine={false} 
                                axisLine={{ stroke: '#e2e8f0' }}
                                tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} 
                              />
                              <YAxis 
                                yAxisId="right" 
                                orientation="right" 
                                tickLine={false} 
                                axisLine={{ stroke: '#e2e8f0' }}
                                tickFormatter={(v) => `${(v * 100).toFixed(1)}%`} 
                              />
                              <Tooltip 
                                contentStyle={{ backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                formatter={(value: any, name: string) => {
                                  if (name.includes("CVR") || name.includes("转化率")) {
                                    return [`${(Number(value) * 100).toFixed(2)}%`, name];
                                  }
                                  return [Number(value).toLocaleString(), name];
                                }}
                              />
                              <Legend iconSize={8} iconType="circle" wrapperStyle={{ paddingTop: '10px' }} />
                              <Bar yAxisId="left" dataKey="marketQc" name="大盘搜索量" fill="#3b82f6" fillOpacity={0.15} stroke="#3b82f6" strokeWidth={1} radius={[4, 4, 0, 0]} barSize={28} />
                              <Line yAxisId="right" type="monotone" dataKey="marketCVR" name="大盘 CVR" stroke="#8b5cf6" strokeWidth={3} dot={{ r: 4, stroke: '#8b5cf6', strokeWidth: 1, fill: '#fff' }} activeDot={{ r: 6 }} connectNulls />
                              <Line yAxisId="right" type="monotone" dataKey="asinCVR" name="本品 ASIN CVR" stroke="#ec4899" strokeWidth={3} dot={{ r: 4, stroke: '#ec4899', strokeWidth: 1, fill: '#fff' }} activeDot={{ r: 6 }} connectNulls />
                            </ComposedChart>
                          </ResponsiveContainer>
                        </div>
                      </div>

                      {/* Right Block: Monthly Align Table (5 Columns) */}
                      <div className="lg:col-span-5 space-y-3">
                        <p className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                          <FileText className="w-4 h-4 text-blue-500" />
                          指标数据对齐明细表 (Monthly Table)
                        </p>
                        
                        <div className="overflow-x-auto rounded-xl border border-slate-100 shadow-3xs bg-white">
                          <table className="w-full text-left border-collapse text-[11px] font-sans">
                            <thead>
                              <tr className="bg-slate-50 text-slate-500 font-extrabold border-b border-slate-200">
                                <th className="p-2.5">分析月份</th>
                                <th className="p-2.5 text-right text-blue-600 font-extrabold">大盘搜索量</th>
                                <th className="p-2.5 text-right text-purple-600 font-extrabold">大盘 CVR</th>
                                <th className="p-2.5 text-right text-pink-600 font-extrabold">本品 CVR</th>
                                <th className="p-2.5 text-right text-emerald-600 font-extrabold">本品购买占比</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-slate-700 font-mono">
                              {annualChartData.map((row) => (
                                <tr key={row.month} className="hover:bg-slate-50/50 transition-colors">
                                  <td className="p-2.5 font-bold text-slate-900">{row.month}</td>
                                  <td className="p-2.5 text-right font-medium text-slate-900">
                                    {row.hasData ? row.marketQc.toLocaleString() : <span className="text-slate-300">未导入</span>}
                                  </td>
                                  <td className="p-2.5 text-right text-purple-600 font-semibold">
                                    {row.hasData ? `${(row.marketCVR * 100).toFixed(2)}%` : '—'}
                                  </td>
                                  <td className="p-2.5 text-right text-pink-600 font-semibold">
                                    {row.hasData ? `${(row.asinCVR * 100).toFixed(2)}%` : '—'}
                                  </td>
                                  <td className="p-2.5 text-right text-emerald-600 font-bold">
                                    {row.hasData ? `${(row.buyShare * 100).toFixed(2)}%` : '—'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot className="bg-slate-50 font-bold text-slate-900 border-t border-slate-200">
                              <tr>
                                <td className="p-2.5">均值/汇总</td>
                                <td className="p-2.5 text-right text-slate-950">
                                  {annualChartData.reduce((sum, r) => sum + r.marketQc, 0).toLocaleString()}
                                </td>
                                <td className="p-2.5 text-right text-purple-700">
                                  {(() => {
                                    const active = annualChartData.filter(r => r.hasData);
                                    if (active.length === 0) return '0.00%';
                                    return `${((active.reduce((sum, r) => sum + r.marketCVR, 0) / active.length) * 100).toFixed(2)}%`;
                                  })()}
                                </td>
                                <td className="p-2.5 text-right text-pink-700">
                                  {(() => {
                                    const active = annualChartData.filter(r => r.hasData);
                                    if (active.length === 0) return '0.00%';
                                    return `${((active.reduce((sum, r) => sum + r.asinCVR, 0) / active.length) * 100).toFixed(2)}%`;
                                  })()}
                                </td>
                                <td className="p-2.5 text-right text-emerald-600">
                                  {(() => {
                                    const active = annualChartData.filter(r => r.hasData);
                                    if (active.length === 0) return '0.00%';
                                    return `${((active.reduce((sum, r) => sum + r.buyShare, 0) / active.length) * 100).toFixed(2)}%`;
                                  })()}
                                </td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* ADVANCED COMPARATIVE OVERLAYS */}
                  <div className="bg-slate-50/50 border border-slate-200 rounded-xl p-5 shadow-3xs space-y-4">
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                      <div className="space-y-1">
                        <h5 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                          <Sliders className="w-3.5 h-3.5 text-indigo-500" />
                          📈 【核心词群多维走势叠加工具】 (Advanced Multi-Keyword Benchmark)
                        </h5>
                        <p className="text-[11px] text-slate-400">
                          支持将多达 20 个核心词在全年月度走势重叠显示，快速查找跑赢大盘的尖子生词。
                        </p>
                      </div>

                      {/* Interactive Action Controls */}
                      <div className="flex flex-wrap items-center gap-2.5 text-xs">
                        {/* Keyword Set Switch */}
                        <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg border border-slate-200">
                          <span className="text-[10px] text-slate-400 px-1 font-semibold">词群:</span>
                          <button
                            onClick={() => {
                              setAnnualTrendKeywordSet('asin');
                              setHiddenAnnualKeywords([]);
                            }}
                            className={`px-2 py-0.5 rounded-md font-semibold transition-all cursor-pointer ${
                              annualTrendKeywordSet === 'asin'
                                ? 'bg-white text-blue-600 shadow-3xs'
                                : 'text-slate-500 hover:text-slate-800'
                            }`}
                          >
                            本品 Top 20
                          </button>
                          <button
                            onClick={() => {
                              setAnnualTrendKeywordSet('market');
                              setHiddenAnnualKeywords([]);
                            }}
                            className={`px-2 py-0.5 rounded-md font-semibold transition-all cursor-pointer ${
                              annualTrendKeywordSet === 'market'
                                ? 'bg-white text-purple-600 shadow-3xs'
                                : 'text-slate-500 hover:text-slate-800'
                            }`}
                          >
                            大盘 Top 20
                          </button>
                        </div>

                        {/* Dimension Switch */}
                        <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg border border-slate-200">
                          <span className="text-[10px] text-slate-400 px-1 font-semibold">指标:</span>
                          {(['search', 'impression', 'click', 'conversion'] as const).map(dim => {
                            const labels = {
                              search: '搜索量',
                              impression: '展示量',
                              click: '点击量',
                              conversion: '转化率'
                            };
                            return (
                              <button
                                key={dim}
                                onClick={() => setAnnualTrendDimension(dim)}
                                className={`px-2 py-0.5 rounded-md font-semibold transition-all cursor-pointer ${
                                  annualTrendDimension === dim
                                    ? 'bg-white text-indigo-600 shadow-3xs'
                                    : 'text-slate-500 hover:text-slate-800'
                                }`}
                              >
                                {labels[dim]}
                              </button>
                            );
                          })}
                        </div>

                        {/* Source Switch */}
                        <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg border border-slate-200">
                          <span className="text-[10px] text-slate-400 px-1 font-semibold">数据源:</span>
                          <button
                            onClick={() => setAnnualTrendSource('market')}
                            className={`px-2 py-0.5 rounded-md font-semibold transition-all cursor-pointer ${
                              annualTrendSource === 'market'
                                ? 'bg-white text-purple-600 shadow-3xs'
                                : 'text-slate-500 hover:text-slate-800'
                            }`}
                          >
                            大盘
                          </button>
                          <button
                            onClick={() => setAnnualTrendSource('asin')}
                            className={`px-2 py-0.5 rounded-md font-semibold transition-all cursor-pointer ${
                              annualTrendSource === 'asin'
                                ? 'bg-white text-blue-600 shadow-3xs'
                                : 'text-slate-500 hover:text-slate-800'
                            }`}
                          >
                            本品
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Pill Badge Keyword Filter Checklist */}
                    <div className="bg-white border border-slate-200 p-3 rounded-xl space-y-2">
                      <div className="flex flex-wrap items-center justify-between text-[11px] font-bold text-slate-600 gap-2">
                        <span className="flex items-center gap-1.5">
                          <Filter className="w-3.5 h-3.5 text-indigo-500" />
                          图表过滤控制: ({selectedTopKeywords.length - hiddenAnnualKeywords.length} / {selectedTopKeywords.length} 已显示)
                        </span>
                        <div className="flex gap-2">
                          <button 
                            onClick={() => setHiddenAnnualKeywords([])}
                            className="text-indigo-600 hover:text-indigo-800 cursor-pointer"
                          >
                            显示全部
                          </button>
                          <span className="text-slate-300">|</span>
                          <button 
                            onClick={() => setHiddenAnnualKeywords(selectedTopKeywords.map(k => k.kw))}
                            className="text-rose-500 hover:text-rose-700 cursor-pointer"
                          >
                            隐藏全部
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
                        {selectedTopKeywords.map((item, index) => {
                          const isHidden = hiddenAnnualKeywords.includes(item.kw);
                          const color = KEYWORD_COLORS[index % KEYWORD_COLORS.length];
                          return (
                            <button
                              key={`filter-${item.kw}`}
                              onClick={() => {
                                if (isHidden) {
                                  setHiddenAnnualKeywords(prev => prev.filter(k => k !== item.kw));
                                } else {
                                  setHiddenAnnualKeywords(prev => [...prev, item.kw]);
                                }
                              }}
                              className={`px-2 py-1 rounded text-[10.5px] font-medium transition-all flex items-center gap-1.5 border cursor-pointer ${
                                !isHidden 
                                  ? 'bg-white border-slate-300 text-slate-700 shadow-3xs font-semibold' 
                                  : 'bg-slate-100 text-slate-400 border-slate-200/60 line-through'
                              }`}
                              style={!isHidden ? { borderLeft: `3px solid ${color}` } : undefined}
                            >
                              <span className="truncate max-w-[130px]" title={item.kw}>{item.kw}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Trend Line Chart */}
                    <div className="h-72 w-full text-[10px] bg-white p-3 rounded-lg border border-slate-100">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={keywordChartData} margin={{ top: 15, right: 15, left: -10, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                          <XAxis dataKey="month" tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
                          <YAxis 
                            tickLine={false} 
                            axisLine={{ stroke: '#e2e8f0' }} 
                            tickFormatter={(val) => {
                              if (annualTrendDimension === 'conversion') {
                                return `${(val * 100).toFixed(1)}%`;
                              }
                              return val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val;
                            }}
                          />
                          <Tooltip 
                            contentStyle={{ backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0' }}
                            formatter={(val: any, name: string) => {
                              if (annualTrendDimension === 'conversion') {
                                return [`${(Number(val) * 100).toFixed(2)}%`, name];
                              }
                              return [Number(val).toLocaleString(), name];
                            }}
                          />
                          <Legend iconSize={8} iconType="circle" />
                          {selectedTopKeywords.map((item, index) => {
                            if (hiddenAnnualKeywords.includes(item.kw)) return null;
                            const color = KEYWORD_COLORS[index % KEYWORD_COLORS.length];
                            return (
                              <Line
                                key={item.kw}
                                type="monotone"
                                dataKey={item.kw}
                                name={item.kw}
                                stroke={color}
                                strokeWidth={2}
                                dot={{ r: 3 }}
                                activeDot={{ r: 5 }}
                                connectNulls
                              />
                            );
                          })}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="border border-dashed border-slate-200 rounded-xl p-12 text-center space-y-4 bg-slate-50/30">
                  <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto text-emerald-600">
                    <Calendar className="w-8 h-8 animate-pulse" />
                  </div>
                  <div className="space-y-1.5 max-w-md mx-auto">
                    <h6 className="text-sm font-extrabold text-slate-800">暂无任何月度历史绩效数据包</h6>
                    <p className="text-xs text-slate-500 leading-relaxed font-medium">
                      请使用上方 <strong className="text-slate-700">“⚡ 智能批量导入月度报告”</strong>，一次性选择并拖入 1 至 12 月份的 SQP 报告，系统将会快速清洗并聚合输出年内所有的转化和成交走势趋势。
                    </p>
                  </div>
                  <div className="pt-2">
                    <label 
                      htmlFor="batch-monthly-upload-btn" 
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs shadow-xs cursor-pointer transition-all inline-flex items-center gap-1.5"
                    >
                      <Download className="w-3.5 h-3.5 rotate-180" />
                      上传月度文件 (.csv / .xlsx)
                    </label>
                    <input
                      type="file"
                      multiple
                      accept=".csv,.xlsx,.xls"
                      onChange={(e) => e.target.files && handleBatchMonthlyUpload(e.target.files)}
                      className="hidden"
                      id="batch-monthly-upload-btn"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Spacer divider before comparison panel */}
          <div className="h-6"></div>

          {/* Ring Comparison Panel - Period-over-period */}
          {compareRows.length > 0 && subTab !== 'annual' && (
            <motion.div 
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-amber-50/20 border-2 border-amber-200/60 rounded-xl p-5 space-y-4 shadow-sm mt-4"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-amber-50/40 p-3 rounded-lg border border-amber-100">
                <div>
                  <h3 className="text-sm font-bold text-amber-900 flex items-center gap-1.5 uppercase tracking-wide">
                    <TrendingUp className="w-5 h-5 text-amber-600" /> SQP 环比追踪和需求动态解读窗
                  </h3>
                  <p className="text-xs text-amber-700/80 mt-0.5">
                    比较当前时段和后续时段的点击/购买转化。直观揭示大盘热词更迭以及自身产品转化率波动。
                  </p>
                </div>
                <button
                  onClick={exportCompareXlsxVal}
                  className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer shadow-xs"
                >
                  <Download className="w-4 h-4" /> 导出环比 Excel
                </button>
              </div>

              {compareTotals && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-white p-3 rounded-lg border border-amber-200 shadow-2xs">
                    <div className="text-[11px] font-semibold text-slate-500 flex items-center justify-between">
                      <span>本 ASIN 点击率 (CTR)</span>
                      <span className="text-[10px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded font-bold">ASIN首图</span>
                    </div>
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="font-mono text-base font-bold text-emerald-800">{(compareTotals.asinCTR_next * 100).toFixed(2)}%</span>
                      <span className="text-xs text-slate-400 font-mono">前 {(compareTotals.asinCTR_current * 100).toFixed(2)}%</span>
                    </div>
                    <div className="mt-1 text-xs">
                      {renderTrendChange(compareTotals.asinCTR_current, compareTotals.asinCTR_change)}
                    </div>
                  </div>

                  <div className="bg-white p-3 rounded-lg border border-amber-200 shadow-2xs">
                    <div className="text-[11px] font-semibold text-slate-500 flex items-center justify-between">
                      <span>大盘平均点击率 (CTR)</span>
                      <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-bold">行业基准</span>
                    </div>
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="font-mono text-base font-bold text-slate-800">{(compareTotals.marketCTR_next * 100).toFixed(2)}%</span>
                      <span className="text-xs text-slate-400 font-mono">前 {(compareTotals.marketCTR_current * 100).toFixed(2)}%</span>
                    </div>
                    <div className="mt-1 text-xs">
                      {renderTrendChange(compareTotals.marketCTR_current, compareTotals.marketCTR_change)}
                    </div>
                  </div>

                  <div className="bg-white p-3 rounded-lg border border-amber-200 shadow-2xs">
                    <div className="text-[11px] font-semibold text-slate-500 flex items-center justify-between">
                      <span>本 ASIN 转化率 (CVR)</span>
                      <span className="text-[10px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded font-bold">承接转化</span>
                    </div>
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="font-mono text-base font-bold text-emerald-800">{(compareTotals.asinCVR_next * 100).toFixed(2)}%</span>
                      <span className="text-xs text-slate-400 font-mono">前 {(compareTotals.asinCVR_current * 100).toFixed(2)}%</span>
                    </div>
                    <div className="mt-1 text-xs">
                      {renderTrendChange(compareTotals.asinCVR_current, compareTotals.asinCVR_change)}
                    </div>
                  </div>

                  <div className="bg-white p-3 rounded-lg border border-amber-200 shadow-2xs">
                    <div className="text-[11px] font-semibold text-slate-500 flex items-center justify-between">
                      <span>大盘平均转化率 (CVR)</span>
                      <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-bold">行业基准</span>
                    </div>
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="font-mono text-base font-bold text-slate-800">{(compareTotals.marketCVR_next * 100).toFixed(2)}%</span>
                      <span className="text-xs text-slate-400 font-mono">前 {(compareTotals.marketCVR_current * 100).toFixed(2)}%</span>
                    </div>
                    <div className="mt-1 text-xs">
                      {renderTrendChange(compareTotals.marketCVR_current, compareTotals.marketCVR_change)}
                    </div>
                  </div>
                </div>
              )}

              <div className="table-wrapper max-h-[450px] custom-scrollbar border border-amber-200 border-dashed rounded-lg overflow-auto">
                <table className="relative w-full border-collapse bg-white">
                  <thead>
                <tr className="bg-amber-50/40 border-b border-amber-200 text-amber-900 text-[10px] font-semibold sticky top-0 z-20">
                  <th className="text-left font-bold uppercase tracking-wider p-3 sticky left-0 bg-amber-50 z-30" style={{ width: `${firstColWidth}px` }}>核心搜索词</th>
                  <th className="text-right font-semibold p-3 cursor-pointer select-none" onClick={() => handleCompareSort('qc_current')}>搜索量(前)</th>
                  <th className="text-right font-semibold p-3 cursor-pointer select-none" onClick={() => handleCompareSort('qc_next')}>搜索量(后)</th>
                  <th className="text-center font-bold p-3 cursor-pointer select-none bg-amber-50/20" onClick={() => handleCompareSort('qc_change')}>流量环比</th>
                  <th className="text-right font-semibold p-3 cursor-pointer select-none" onClick={() => handleCompareSort('ord_current')}>订单(前)</th>
                  <th className="text-right font-semibold p-3 cursor-pointer select-none" onClick={() => handleCompareSort('ord_next')}>订单(后)</th>
                  <th className="text-center font-bold p-3 cursor-pointer select-none bg-amber-50/20" onClick={() => handleCompareSort('ord_change')}>订单环比</th>
                  <th className="text-right font-semibold p-3 cursor-pointer select-none" onClick={() => handleCompareSort('clk_current')}>点击(前)</th>
                  <th className="text-right font-semibold p-3 cursor-pointer select-none" onClick={() => handleCompareSort('clk_next')}>点击(后)</th>
                  <th className="text-center font-bold p-3 cursor-pointer select-none" onClick={() => handleCompareSort('clk_change')}>点击环比</th>
                  <th className="text-center font-semibold p-3 cursor-pointer select-none text-slate-600" onClick={() => handleCompareSort('impShare_current')}>曝占比(前)</th>
                  <th className="text-center font-semibold p-3 cursor-pointer select-none text-slate-600" onClick={() => handleCompareSort('impShare_next')}>曝占比(后)</th>
                  <th className="text-center font-bold p-3 cursor-pointer select-none text-slate-705" onClick={() => handleCompareSort('impShare_change')}>曝占比差</th>
                  <th className="text-center font-semibold p-3 cursor-pointer select-none text-blue-700/80" onClick={() => handleCompareSort('clickShare_current')}>点占比(前)</th>
                  <th className="text-center font-semibold p-3 cursor-pointer select-none text-blue-700/80" onClick={() => handleCompareSort('clickShare_next')}>点占比(后)</th>
                  <th className="text-center font-bold p-3 cursor-pointer select-none text-blue-805" onClick={() => handleCompareSort('clickShare_change')}>点占比差</th>
                  <th className="text-center font-semibold p-3 cursor-pointer select-none text-emerald-700" onClick={() => handleCompareSort('buyShare_current')}>购占比(前)</th>
                  <th className="text-center font-semibold p-3 cursor-pointer select-none text-emerald-700" onClick={() => handleCompareSort('buyShare_next')}>购占比(后)</th>
                  <th className="text-center font-bold p-3 cursor-pointer select-none bg-amber-50/20 text-emerald-805" onClick={() => handleCompareSort('buyShare_change')}>购占比差</th>
                  <th className="text-center font-semibold p-3 cursor-pointer select-none hover:text-amber-950" onClick={() => handleCompareSort('marketPrice_current')}>均价(前)</th>
                  <th className="text-center font-semibold p-3 cursor-pointer select-none hover:text-amber-950" onClick={() => handleCompareSort('marketPrice_next')}>均价(后)</th>
                  <th className="text-right font-semibold p-3 cursor-pointer select-none text-slate-600 hover:text-slate-800" onClick={() => handleCompareSort('marketCTR_current')} title="大盘点击率 CTR(前)：总曝光量/总次数">大盘CTR(前)</th>
                  <th className="text-right font-semibold p-3 cursor-pointer select-none text-slate-600 hover:text-slate-800" onClick={() => handleCompareSort('marketCTR_next')} title="大盘点击率 CTR(后)：总曝光量/总次数">大盘CTR(后)</th>
                  <th className="text-center font-bold p-3 cursor-pointer select-none text-slate-705 bg-amber-50/20 hover:text-slate-905" onClick={() => handleCompareSort('marketCTR_change')} title="大盘点击率环比">大盘CTR环比</th>
                  <th className="text-right font-semibold p-3 cursor-pointer select-none text-emerald-700 hover:text-emerald-900" onClick={() => handleCompareSort('asinCTR_current')} title="本ASIN点击率 CTR(前): 曝光量：ASIN 计数/点击量：ASIN 数量">本ASIN CTR(前)</th>
                  <th className="text-right font-semibold p-3 cursor-pointer select-none text-emerald-700 hover:text-emerald-900" onClick={() => handleCompareSort('asinCTR_next')} title="本ASIN点击率 CTR(后): 曝光量：ASIN 计数/点击量：ASIN 数量">本ASIN CTR(后)</th>
                  <th className="text-center font-bold p-3 cursor-pointer select-none text-emerald-805 bg-emerald-50/10 hover:text-emerald-950" onClick={() => handleCompareSort('asinCTR_change')} title="本ASIN点击率环比">本ASIN CTR环比</th>
                  <th className="text-right font-semibold p-3 cursor-pointer select-none text-slate-600 hover:text-slate-800" onClick={() => handleCompareSort('marketCVR_current')}>大盘CVR(前)</th>
                  <th className="text-right font-semibold p-3 cursor-pointer select-none text-slate-600 hover:text-slate-800" onClick={() => handleCompareSort('marketCVR_next')}>大盘CVR(后)</th>
                  <th className="text-center font-bold p-3 cursor-pointer select-none text-slate-705 bg-amber-50/20 hover:text-slate-905" onClick={() => handleCompareSort('marketCVR_change')}>大盘CVR环比</th>
                  <th className="text-right font-semibold p-3 cursor-pointer select-none text-emerald-700 hover:text-emerald-900" onClick={() => handleCompareSort('asinCVR_current')}>本ASIN CVR(前)</th>
                  <th className="text-right font-semibold p-3 cursor-pointer select-none text-emerald-700 hover:text-emerald-900" onClick={() => handleCompareSort('asinCVR_next')}>本ASIN CVR(后)</th>
                  <th className="text-center font-bold p-3 cursor-pointer select-none text-emerald-805 bg-emerald-50/10 hover:text-emerald-950" onClick={() => handleCompareSort('asinCVR_change')}>本ASIN CVR环比</th>
                  <th className="text-left font-bold py-3 px-4 min-w-[240px]">量度异动深度解读</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-amber-100 text-xs text-slate-700">
                {processedCompareList.slice(0, compareLimit).map((cr, idx) => (
                  <tr key={idx} className="hover:bg-amber-50/10 transition-colors">
                    <td className="p-3 sticky left-0 bg-slate-50 font-semibold border-r border-amber-100 text-amber-900 truncate" style={{ width: `${firstColWidth}px`, maxWidth: `${firstColWidth}px` }} title={cr.kw}>
                      {cr.kw}
                    </td>
                    <td className="p-3 text-right font-mono text-[11px]">{cr.qc_current.toLocaleString()}</td>
                    <td className="p-3 text-right font-mono text-[11px]">{cr.qc_next.toLocaleString()}</td>
                    <td className="p-3 text-center bg-amber-50/10">{renderTrendChange(cr.qc_current, cr.qc_change)}</td>
                    <td className="p-3 text-right font-mono text-[11px] font-semibold">{cr.ord_current}</td>
                    <td className="p-3 text-right font-mono text-[11px] font-semibold">{cr.ord_next}</td>
                    <td className="p-3 text-center bg-amber-50/10">{renderTrendChange(cr.ord_current, cr.ord_change)}</td>
                    <td className="p-3 text-right font-mono text-[11px]">{cr.clk_current}</td>
                    <td className="p-3 text-right font-mono text-[11px]">{cr.clk_next}</td>
                    <td className="p-3 text-center">{renderTrendChange(cr.clk_current, cr.clk_change)}</td>
                    <td className="p-3 text-center font-mono text-[11px] text-slate-600">{(cr.impShare_current * 100).toFixed(2)}%</td>
                    <td className="p-3 text-center font-mono text-[11px] text-slate-600">{(cr.impShare_next * 100).toFixed(2)}%</td>
                    <td className="p-3 text-center bg-amber-50/10">{renderPointChange(cr.impShare_change)}</td>
                    <td className="p-3 text-center font-mono text-[11px] text-blue-800">{(cr.clickShare_current * 100).toFixed(2)}%</td>
                    <td className="p-3 text-center font-mono text-[11px] text-blue-800">{(cr.clickShare_next * 100).toFixed(2)}%</td>
                    <td className="p-3 text-center">{renderPointChange(cr.clickShare_change)}</td>
                    <td className="p-3 text-center font-mono text-[11px] text-emerald-700">{(cr.buyShare_current * 100).toFixed(2)}%</td>
                    <td className="p-3 text-center font-mono text-[11px] text-emerald-700">{(cr.buyShare_next * 100).toFixed(2)}%</td>
                    <td className="p-3 text-center bg-amber-50/10">{renderPointChange(cr.buyShare_change)}</td>
                    <td className="p-3 text-center font-mono text-[11px]">${cr.marketPrice_current.toFixed(2)}</td>
                    <td className="p-3 text-center font-mono text-[11px] font-medium">${cr.marketPrice_next.toFixed(2)}</td>
                    <td className="p-3 text-right font-mono text-[11px] text-slate-500">{(cr.marketCTR_current * 100).toFixed(2)}%</td>
                    <td className="p-3 text-right font-mono text-[11px] font-medium text-slate-700">{(cr.marketCTR_next * 100).toFixed(2)}%</td>
                    <td className="p-3 text-center bg-amber-50/5">{renderTrendChange(cr.marketCTR_current, cr.marketCTR_change)}</td>
                    <td className="p-3 text-right font-mono text-[11px] text-emerald-600">{(cr.asinCTR_current * 100).toFixed(2)}%</td>
                    <td className="p-3 text-right font-mono text-[11px] font-bold text-emerald-800">{(cr.asinCTR_next * 100).toFixed(2)}%</td>
                    <td className="p-3 text-center bg-emerald-50/5">{renderTrendChange(cr.asinCTR_current, cr.asinCTR_change)}</td>
                    <td className="p-3 text-right font-mono text-[11px] text-slate-500">{(cr.marketCVR_current * 100).toFixed(2)}%</td>
                    <td className="p-3 text-right font-mono text-[11px] font-medium text-slate-700">{(cr.marketCVR_next * 100).toFixed(2)}%</td>
                    <td className="p-3 text-center bg-amber-50/5">{renderTrendChange(cr.marketCVR_current, cr.marketCVR_change)}</td>
                    <td className="p-3 text-right font-mono text-[11px] text-emerald-600">{(cr.asinCVR_current * 100).toFixed(2)}%</td>
                    <td className="p-3 text-right font-mono text-[11px] font-bold text-emerald-800">{(cr.asinCVR_next * 100).toFixed(2)}%</td>
                    <td className="p-3 text-center bg-emerald-50/5">{renderTrendChange(cr.asinCVR_current, cr.asinCVR_change)}</td>
                    <td className="p-3 pl-4 text-left font-normal text-amber-955 text-[11px] max-w-[320px] min-w-[200px]" title={cr.trend}>
                      <span className="block truncate max-w-[320px]">
                        {cr.trend}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              {compareTotals && (
                <tfoot className="sticky bottom-0 z-20 shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
                  <tr className="font-bold border-t-2 border-amber-250 text-amber-955">
                    <td 
                      className="p-3 sticky left-0 bg-amber-50 border-r border-amber-155 text-amber-950 font-extrabold truncate"
                      style={{ width: `${firstColWidth}px`, minWidth: `${firstColWidth}px`, maxWidth: `${firstColWidth}px`, position: 'sticky', bottom: 0, left: 0, zIndex: 30 }}
                      title="数据总和"
                    >
                      数据总和 (已贴底)
                    </td>
                    <td className="p-3 text-right bg-amber-50 font-mono text-[11px] font-extrabold" style={{ position: 'sticky', bottom: 0 }}>{compareTotals.qc_current.toLocaleString()}</td>
                    <td className="p-3 text-right bg-amber-50 font-mono text-[11px] font-extrabold" style={{ position: 'sticky', bottom: 0 }}>{compareTotals.qc_next.toLocaleString()}</td>
                    <td className="p-3 text-center bg-amber-100/40 font-extrabold" style={{ position: 'sticky', bottom: 0 }}>{renderTrendChange(compareTotals.qc_current, compareTotals.qc_change)}</td>
                    <td className="p-3 text-right bg-amber-50 font-mono text-[11px] font-extrabold" style={{ position: 'sticky', bottom: 0 }}>{compareTotals.ord_current.toLocaleString()}</td>
                    <td className="p-3 text-right bg-amber-50 font-mono text-[11px] font-extrabold" style={{ position: 'sticky', bottom: 0 }}>{compareTotals.ord_next.toLocaleString()}</td>
                    <td className="p-3 text-center bg-amber-100/40 font-extrabold" style={{ position: 'sticky', bottom: 0 }}>{renderTrendChange(compareTotals.ord_current, compareTotals.ord_change)}</td>
                    <td className="p-3 text-right bg-amber-50 font-mono text-[11px] font-extrabold" style={{ position: 'sticky', bottom: 0 }}>{compareTotals.clk_current.toLocaleString()}</td>
                    <td className="p-3 text-right bg-amber-50 font-mono text-[11px] font-extrabold" style={{ position: 'sticky', bottom: 0 }}>{compareTotals.clk_next.toLocaleString()}</td>
                    <td className="p-3 text-center bg-amber-50 font-extrabold" style={{ position: 'sticky', bottom: 0 }}>{renderTrendChange(compareTotals.clk_current, compareTotals.clk_change)}</td>
                    <td className="p-3 text-center bg-amber-50 font-mono text-[11px] font-extrabold" style={{ position: 'sticky', bottom: 0 }}>{(compareTotals.impShare_current * 100).toFixed(2)}%</td>
                    <td className="p-3 text-center bg-amber-50 font-mono text-[11px] font-extrabold" style={{ position: 'sticky', bottom: 0 }}>{(compareTotals.impShare_next * 100).toFixed(2)}%</td>
                    <td className="p-3 text-center bg-amber-50/10 font-extrabold" style={{ position: 'sticky', bottom: 0 }}>{renderPointChange(compareTotals.impShare_change)}</td>
                    <td className="p-3 text-center bg-amber-50 font-mono text-[11px] font-extrabold" style={{ position: 'sticky', bottom: 0 }}>{(compareTotals.clickShare_current * 100).toFixed(2)}%</td>
                    <td className="p-3 text-center bg-amber-50 font-mono text-[11px] font-extrabold" style={{ position: 'sticky', bottom: 0 }}>{(compareTotals.clickShare_next * 100).toFixed(2)}%</td>
                    <td className="p-3 text-center bg-amber-50 font-extrabold" style={{ position: 'sticky', bottom: 0 }}>{renderPointChange(compareTotals.clickShare_change)}</td>
                    <td className="p-3 text-center bg-amber-50 font-mono text-[11px] font-extrabold" style={{ position: 'sticky', bottom: 0 }}>{(compareTotals.buyShare_current * 100).toFixed(2)}%</td>
                    <td className="p-3 text-center bg-amber-50 font-mono text-[11px] font-extrabold" style={{ position: 'sticky', bottom: 0 }}>{(compareTotals.buyShare_next * 100).toFixed(2)}%</td>
                    <td className="p-3 text-center bg-amber-100/40 font-extrabold" style={{ position: 'sticky', bottom: 0 }}>{renderPointChange(compareTotals.buyShare_change)}</td>
                    <td className="p-3 text-center bg-amber-50 font-mono text-[11px] font-extrabold" style={{ position: 'sticky', bottom: 0 }}>${compareTotals.marketPrice_current.toFixed(2)}</td>
                    <td className="p-3 text-center bg-amber-50 font-mono text-[11px] font-extrabold" style={{ position: 'sticky', bottom: 0 }}>${compareTotals.marketPrice_next.toFixed(2)}</td>
                    <td className="p-3 text-right bg-amber-50 font-mono text-[11px] font-extrabold text-slate-600" style={{ position: 'sticky', bottom: 0 }}>{(compareTotals.marketCTR_current * 100).toFixed(2)}%</td>
                    <td className="p-3 text-right bg-amber-50 font-mono text-[11px] font-extrabold text-slate-800" style={{ position: 'sticky', bottom: 0 }}>{(compareTotals.marketCTR_next * 100).toFixed(2)}%</td>
                    <td className="p-3 text-center bg-amber-100/40 font-extrabold" style={{ position: 'sticky', bottom: 0 }}>{renderTrendChange(compareTotals.marketCTR_current, compareTotals.marketCTR_change)}</td>
                    <td className="p-3 text-right bg-amber-50 font-mono text-[11px] font-extrabold text-emerald-600" style={{ position: 'sticky', bottom: 0 }}>{(compareTotals.asinCTR_current * 100).toFixed(2)}%</td>
                    <td className="p-3 text-right bg-amber-50 font-mono text-[11px] font-extrabold text-emerald-800" style={{ position: 'sticky', bottom: 0 }}>{(compareTotals.asinCTR_next * 100).toFixed(2)}%</td>
                    <td className="p-3 text-center bg-emerald-100/40 font-extrabold" style={{ position: 'sticky', bottom: 0 }}>{renderTrendChange(compareTotals.asinCTR_current, compareTotals.asinCTR_change)}</td>
                    <td className="p-3 text-right bg-amber-50 font-mono text-[11px] font-extrabold text-slate-600" style={{ position: 'sticky', bottom: 0 }}>{(compareTotals.marketCVR_current * 100).toFixed(2)}%</td>
                    <td className="p-3 text-right bg-amber-50 font-mono text-[11px] font-extrabold text-slate-800" style={{ position: 'sticky', bottom: 0 }}>{(compareTotals.marketCVR_next * 100).toFixed(2)}%</td>
                    <td className="p-3 text-center bg-amber-100/40 font-extrabold" style={{ position: 'sticky', bottom: 0 }}>{renderTrendChange(compareTotals.marketCVR_current, compareTotals.marketCVR_change)}</td>
                    <td className="p-3 text-right bg-amber-50 font-mono text-[11px] font-extrabold text-emerald-600" style={{ position: 'sticky', bottom: 0 }}>{(compareTotals.asinCVR_current * 100).toFixed(2)}%</td>
                    <td className="p-3 text-right bg-amber-50 font-mono text-[11px] font-extrabold text-emerald-800" style={{ position: 'sticky', bottom: 0 }}>{(compareTotals.asinCVR_next * 100).toFixed(2)}%</td>
                    <td className="p-3 text-center bg-emerald-100/40 font-extrabold" style={{ position: 'sticky', bottom: 0 }}>{renderTrendChange(compareTotals.asinCVR_current, compareTotals.asinCVR_change)}</td>
                    <td className="p-3 pl-4 text-left bg-amber-50 font-semibold text-amber-955 text-[11px]" style={{ position: 'sticky', bottom: 0 }}>已贴底校验</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {processedCompareList.length > compareLimit && (
            <div className="text-center pt-2">
              <button
                onClick={() => setCompareLimit(prev => prev + 100)}
                className="px-4 py-2 border border-dashed border-amber-350 bg-white shadow-2xs hover:bg-amber-50/30 hover:border-amber-450 text-xs text-amber-800 font-bold rounded-lg transition-all inline-flex items-center gap-1 cursor-pointer"
              >
                <ChevronDown className="w-4 h-4" /> 展开加载更多环比行 ({processedCompareList.length - compareLimit}数据单元)
              </button>
            </div>
          )}
        </motion.div>
      )}
        </React.Fragment>
      )}
    </div>
  );
}
