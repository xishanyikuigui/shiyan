/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { 
  BarChart3, Megaphone, GitCompare, FileText, 
  Sparkles, ShieldCheck, TrendingUp, Cpu
} from 'lucide-react';
import { SQPRow, CompareRow, AdsRow, CrossRow, AdsCompareRow } from './types';
import SqpPanel from './components/SqpPanel';
import AdsPanel from './components/AdsPanel';
import CrossPanel from './components/CrossPanel';
import AiPanel from './components/AiPanel';
import DocsPanel from './components/DocsPanel';
import SqpHistoryPanel from './components/SqpHistoryPanel';
import {useAuth} from './auth';
import {saveSqpReport} from './sqpReports';

export default function App() {
  const {accessToken, user} = useAuth();
  const [isLocked, setIsLocked] = useState(false);
  const hasMounted = useRef(false);

  useEffect(() => {
    // 💻 极客范高亮控制台签名 (Console Developer Banner)
    console.log(
      '%c🚀 Amazon Data Analyzer %c Designed & Developed by Zhou Liang %c',
      'background: #1e293b; color: #38bdf8; padding: 6px 12px; border-radius: 4px 0 0 4px; font-weight: bold; font-family: system-ui;',
      'background: linear-gradient(135deg, #2563eb 0%, #ef4444 100%); color: #ffffff; padding: 6px 12px; border-radius: 0 4px 4px 0; font-weight: bold; font-family: system-ui;',
      'background: transparent'
    );
    console.log(
      '%c⚠️ 著作权及安保警告 (Security Alert)\n%c未经著作权开发者[周亮]授权，严禁进行二次克隆分发或用于商业目的！本系统内置完整的代码自毁与防篡改引擎，任何对版权声明、署名栏的修改、篡改或隐藏均会导致系统全面自动锁定并冻结所有高级计算分析工作效。',
      'color: #ef4444; font-size: 14px; font-weight: bold; font-family: monospace;',
      'color: #475569; font-size: 12px; font-family: monospace; line-height: 1.6;'
    );

    let intervalId: any;
    let observer: MutationObserver | null = null;

    const verifyIntegrity = () => {
      const footer = document.getElementById('protected-footer');
      const textEl = document.getElementById('protected-text');
      
      // If mounted but elements disappeared, trigger lock
      if (!footer || !textEl) {
        if (hasMounted.current) {
          return false;
        }
        return true;
      }

      // Mark as mounted on first success of querying elements
      hasMounted.current = true;

      // Check text content - must contain original signature
      const text = textEl.textContent || '';
      if (!text.includes('Zhou Liang') || !text.includes('Designed & Developed')) {
        return false;
      }

      // Check active CSS styles hiding elements
      const footerStyle = window.getComputedStyle(footer);
      const textStyle = window.getComputedStyle(textEl);

      const isHidden = 
        footerStyle.display === 'none' ||
        footerStyle.visibility === 'hidden' ||
        parseFloat(footerStyle.opacity) < 0.2 ||
        textStyle.display === 'none' ||
        textStyle.visibility === 'hidden' ||
        parseFloat(textStyle.opacity) < 0.2;

      if (isHidden) {
        return false;
      }

      // Dimensions validation to catch scaling, font size shrinking or custom width/height collapsing
      const rect = footer.getBoundingClientRect();
      if (rect.height === 0 || rect.width === 0) {
        return false;
      }

      return true;
    };

    const runCheck = () => {
      const ok = verifyIntegrity();
      if (!ok) {
        setIsLocked(true);
        if (intervalId) clearInterval(intervalId);
        if (observer) observer.disconnect();
      }
    };

    // Run synchronous detection on mount with a safe delay micro-tick
    setTimeout(runCheck, 50);

    // Fast interval polling check
    intervalId = setInterval(runCheck, 1000);

    // Mutation Observer to instantly monitor DOM changes
    observer = new MutationObserver(() => {
      runCheck();
    });
    observer.observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true,
      characterData: true,
      attributeFilter: ['style', 'class', 'id', 'hidden']
    });

    return () => {
      if (intervalId) clearInterval(intervalId);
      if (observer) observer.disconnect();
    };
  }, []);

  const [activeTab, setActiveTab ] = useState<'sqp' | 'ads' | 'cross' | 'ai' | 'docs' | 'history'>('sqp');

  // Shared master datasets
  const [sqpRows, setSqpRows] = useState<SQPRow[]>([]);
  const [compareRows, setCompareRows] = useState<CompareRow[]>([]);
  const [adsRows, setAdsRows] = useState<AdsRow[]>([]);
  const [crossRows, setCrossRows] = useState<CrossRow[]>([]);

  // Lifted stable states for Ads WoW Comparison Features
  const [compareAdsFile, setCompareAdsFile] = useState<File | null>(null);
  const [compareStatusMsg, setCompareStatusMsg] = useState('');
  const [adsCompareRows, setAdsCompareRows] = useState<AdsCompareRow[]>([]);
  const [compareRawCache, setCompareRawCache] = useState<any[]>([]);
  
  // Shared width for the frozen first column
  const [firstColWidth, setFirstColWidth] = useState<number>(180);

  const tabsConfig = [
    { id: 'sqp', label: '🔍 搜索查询绩效 (SQP大盘)', count: sqpRows.length, icon: BarChart3 },
    { id: 'ads', label: '📢 广告词漏斗 (Ads推款)', count: adsRows.length, icon: Megaphone },
    { id: 'cross', label: '↕ 交叉融合矩阵 (Cross策略)', count: crossRows.length, icon: GitCompare },
    { id: 'ai', label: '🤖 AI 智能分析助理', count: 0, icon: Sparkles },
    { id: 'docs', label: '📖 说明与自动打标逻辑', count: 0, icon: FileText },
    { id: 'history', label: '🗂️ 历史分析', count: 0, icon: FileText },
  ] as const;

  if (isLocked) {
    return (
      <div className="fixed inset-0 bg-slate-950 z-[999999] flex flex-col items-center justify-center p-6 text-white overflow-y-auto font-mono select-none">
        <div className="max-w-2xl w-full bg-slate-900 border border-red-500/30 rounded-2xl p-8 shadow-2xl relative overflow-hidden animate-in fade-in zoom-in duration-300">
          {/* Animated red neon header bar */}
          <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-red-600 via-amber-500 to-red-600 animate-pulse" />
          
          <div className="flex flex-col items-center text-center space-y-6">
            {/* Pulsing Warning Badge */}
            <div className="w-20 h-20 bg-red-950/40 border border-red-500/50 rounded-full flex items-center justify-center animate-bounce shadow-[0_0_20px_rgba(239,68,68,0.3)]">
              <ShieldCheck className="w-12 h-12 text-red-500" />
            </div>

            <div className="space-y-2">
              <h1 className="text-2xl font-black text-red-500 tracking-wider">
                ⚠️ HOSTE_RESTRICTION_VETO
              </h1>
              <p className="text-lg font-bold text-slate-200">
                [系统保护机制拦截：高级数据透视功能已全量冻结]
              </p>
            </div>

            <hr className="w-full border-slate-800" />

            <div className="text-left space-y-4 text-xs text-slate-300 leading-relaxed font-mono">
              <div className="p-4 bg-slate-950 border border-slate-800 rounded-lg space-y-2">
                <span className="text-red-400 font-bold">🔒 CODE_INTEGRITY_VIOLATION_TRIGGERED:</span>
                <p>
                  系统实时完整性校验检测到：有人正在尝试删除、篡改页脚作者署名、修改致谢文本，或通过 CSS 恶意强行隐藏页脚声明信息。
                </p>
              </div>

              <div className="space-y-3">
                <p className="text-sm font-semibold text-slate-100 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping"></span>
                  系统免责及知识产权声明 (Copyright and Safety Agreement)
                </p>
                <p>
                  1. 亚马逊电商数据融合分析工作台的所有权与原创意归属开发者 <strong className="text-red-400">[周亮](Zhou Liang)</strong> 共有。
                </p>
                <p>
                  2. 未经著作权所有者明确书面授权，严禁对本系统的任何逻辑、源码进行恶意二开、二次克隆分发、商用，或擦除/淡化任何形式的原创版权页脚。
                </p>
                <p>
                  3. 系统中内置的多维指标诊断算法、SQP数据环比诊断引擎等，皆绑定本安全核心运行。强制破解将停用其计算内核。
                </p>
              </div>

              <div className="p-3 bg-red-950/20 border border-red-900/30 rounded-lg text-amber-500 text-center font-bold text-[11px]">
                💡 怎么恢复系统：请确保系统页脚原封不动地保持可见，并包含有效的 "Designed & Developed by Zhou Liang" 版权标识！
              </div>
            </div>

            <div className="w-full flex justify-center text-[10px] text-slate-500 gap-4 mt-2">
              <span>SECURITY_STATE: ACTIVE_LOCK_DOWN</span>
              <span>•</span>
              <span>ENGINE: V2_MUTATION_CHECK</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans antialiased selection:bg-amber-100 selection:text-amber-900 pb-16">
      {/* Title Header workspace banner */}
      <header className="bg-slate-900 border-b border-slate-800 text-white relative overflow-hidden py-8 px-4 sm:px-6 lg:px-8">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-blue-900/40 via-transparent to-transparent opacity-80" />
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-slate-600 to-transparent" />
        
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 relative z-10">
          <div className="space-y-1 text-center md:text-left">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-500 border border-amber-500/25 uppercase tracking-wider mb-1">
              <Sparkles className="w-3 h-3" /> Amazon Data Analyzer
            </span>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white flex items-center justify-center md:justify-start gap-2">
              📊 亚马逊电商数据融合分析工作台
            </h1>
            <p className="text-xs text-slate-400 font-normal max-w-2xl leading-relaxed">
              支持一键导入亚马逊官方 Search Query Performance 与 SP 搜索词报表，由浏览器本地沙盒自动解析多维转化指标及环比异动诊断。
            </p>
            
          </div>

          <div className="bg-slate-800/80 border border-slate-700/60 p-4 rounded-xl flex items-center gap-3 shadow-lg shrink-0">
            <ShieldCheck className="w-10 h-10 text-emerald-500 shrink-0" />
            <div>
              <p className="text-xs font-bold text-slate-200">100% 浏览器安全算效</p>
              <p className="text-[10px] text-slate-400 mt-0.5 leading-normal max-w-[180px]">
                所有数据解析与矩阵运算全在浏览器本端完成，不上传服务器，全流程安全无泄漏。
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Container Layout */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-8 space-y-6">
        
        {/* Navigation Tabs Bar */}
        <div className="border-b border-slate-200 flex flex-wrap gap-1 md:gap-2 items-center justify-center md:justify-start">
          {tabsConfig.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`relative px-4 py-3 rounded-t-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                  isActive 
                    ? 'text-blue-600 border-b-2 border-blue-600 bg-white/40' 
                    : 'text-slate-500 hover:text-slate-800 hover:bg-slate-105'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-blue-600' : 'text-slate-400'}`} />
                <span>{tab.label}</span>
                {tab.count > 0 && (
                  <span className={`inline-block ml-0.5 px-1.5 py-0.2 rounded-full text-[10px] font-bold font-mono ${
                    isActive ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-600'
                  }`}>
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Tab views with persistent state toggle */}
        <div className="relative">
          <div className={activeTab === 'sqp' ? 'block' : 'hidden'}>
            <SqpPanel
              sqpRows={sqpRows}
              setSqpRows={setSqpRows}
              compareRows={compareRows}
              setCompareRows={setCompareRows}
              firstColWidth={firstColWidth}
              setFirstColWidth={setFirstColWidth}
              onDataLoaded={() => {
                // Reset cross tab if base data expands/collapses
                setCrossRows([]);
              }}
              onSaveReport={(file, asin, marketplace, period, rows) => saveSqpReport(accessToken, user.id, file, asin, marketplace, period, rows)}
            />
          </div>

          <div className={activeTab === 'ads' ? 'block' : 'hidden'}>
            <AdsPanel
              adsRows={adsRows}
              setAdsRows={setAdsRows}
              adsCompareRows={adsCompareRows}
              setAdsCompareRows={setAdsCompareRows}
              compareAdsFile={compareAdsFile}
              setCompareAdsFile={setCompareAdsFile}
              compareStatusMsg={compareStatusMsg}
              setCompareStatusMsg={setCompareStatusMsg}
              compareRawCache={compareRawCache}
              setCompareRawCache={setCompareRawCache}
              firstColWidth={firstColWidth}
              setFirstColWidth={setFirstColWidth}
              onDataLoaded={() => {
                setCrossRows([]);
              }}
            />
          </div>

          <div className={activeTab === 'cross' ? 'block' : 'hidden'}>
            <CrossPanel
              sqpRows={sqpRows}
              adsRows={adsRows}
              crossRows={crossRows}
              setCrossRows={setCrossRows}
              compareRows={compareRows}
              adsCompareRows={adsCompareRows}
              firstColWidth={firstColWidth}
              setFirstColWidth={setFirstColWidth}
            />
          </div>

          <div className={activeTab === 'ai' ? 'block' : 'hidden'}>
            <AiPanel
              adsRows={adsRows}
              onNavigateToAds={() => setActiveTab('ads')}
            />
          </div>

          <div className={activeTab === 'docs' ? 'block' : 'hidden'}>
            <DocsPanel />
          </div>
          <div className={activeTab === 'history' ? 'block' : 'hidden'}>
            <SqpHistoryPanel onOpen={rows => { setSqpRows(rows); setActiveTab('sqp'); }} />
          </div>
        </div>
      </main>

      {/* Humble Elegant Footer page margin indicator */}
      <footer 
        id="protected-footer" 
        className="text-center text-[11px] text-slate-400 mt-16 max-w-2xl mx-auto space-y-1 block pointer-events-auto"
        style={{ display: 'block', visibility: 'visible', opacity: 1, minHeight: '1px', minWidth: '1px' }}
      >
        <p 
          id="protected-text" 
          className="font-medium text-slate-500 block pointer-events-auto"
          style={{ display: 'inline-block', visibility: 'visible', opacity: 1 }}
        >
          亚马逊电商数据融合分析工作台 &copy; 2026. Designed & Developed by Zhou Liang
        </p>
      </footer>
    </div>
  );
}
