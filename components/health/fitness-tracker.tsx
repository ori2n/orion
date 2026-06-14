'use client';

import GymTracker from './gym-tracker';
import ActivityTracker from './activity-tracker';
import PhysiqueTracker from './physique-tracker';

export type FitnessTab = 'gym' | 'activity' | 'physique';

const TABS: { key: FitnessTab; label: string; icon: string }[] = [
  { key: 'gym',      label: 'GYM',       icon: '💪' },
  { key: 'activity', label: 'ACTIVITY',  icon: '🏃' },
  { key: 'physique', label: 'PHYSIQUE',  icon: '📏' },
];

export default function FitnessTracker({
  activeTab,
  onTabChange,
}: {
  activeTab: FitnessTab;
  onTabChange: (tab: FitnessTab) => void;
}) {
  const handleTabChange = (tab: FitnessTab) => {
    onTabChange(tab);
  };

  // When physique tab is active in dual-panel mode, render a placeholder
  // since the actual content is rendered by HealthDashboard as dual panels
  if (activeTab === 'physique') {
    return (
      <div className="space-y-4">
        <TabBar activeTab={activeTab} onTabChange={handleTabChange} />
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <span className="mb-2 text-3xl opacity-40">📏</span>
          <p className="text-sm font-medium text-zinc-400">Physique log &amp; gallery</p>
          <p className="mt-1 text-[11px] text-zinc-600">
            Log appears left of core · Gallery appears right of core
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <TabBar activeTab={activeTab} onTabChange={handleTabChange} />
      {activeTab === 'gym' && <GymTracker />}
      {activeTab === 'activity' && <ActivityTracker />}
    </div>
  );
}

function TabBar({
  activeTab,
  onTabChange,
}: {
  activeTab: FitnessTab;
  onTabChange: (tab: FitnessTab) => void;
}) {
  return (
    <div className="flex rounded-lg border border-zinc-800 bg-zinc-900/60 p-0.5">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onTabChange(tab.key)}
          type="button"
          className={`flex items-center justify-center gap-1.5 flex-1 rounded-md px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] transition-all duration-200 ${
            activeTab === tab.key
              ? 'bg-cyan-600/20 text-cyan-300 shadow-sm'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <span className="text-[10px]">{tab.icon}</span>
          {tab.label}
        </button>
      ))}
    </div>
  );
}
