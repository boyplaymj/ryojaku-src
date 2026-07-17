import React from 'react';
import { Category } from '../types';
import { Utensils, Trophy, Plane, Gamepad2, Sparkles } from 'lucide-react';

interface CategoryBadgeProps {
  category: Category;
  className?: string;
  onClick?: () => void;
  isSelected?: boolean;
}

const config = {
  [Category.FOOD]: { label: '美食', icon: Utensils, color: 'bg-orange-500/10 text-orange-400 border border-orange-500/20', active: 'bg-orange-500 text-white shadow-[0_0_0.9375rem_rgba(249,115,22,0.4)]' },
  [Category.SPORTS]: { label: '運動', icon: Trophy, color: 'bg-blue-500/10 text-blue-400 border border-blue-500/20', active: 'bg-blue-500 text-white shadow-[0_0_0.9375rem_rgba(59,130,246,0.4)]' },
  [Category.TRAVEL]: { label: '旅遊', icon: Plane, color: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20', active: 'bg-emerald-500 text-white shadow-[0_0_0.9375rem_rgba(16,185,129,0.4)]' },
  [Category.GAME]: { label: '娛樂', icon: Gamepad2, color: 'bg-purple-500/10 text-purple-400 border border-purple-500/20', active: 'bg-purple-500 text-white shadow-[0_0_0.9375rem_rgba(168,85,247,0.4)]' },
  [Category.OTHER]: { label: '其他', icon: Sparkles, color: 'bg-slate-800 text-slate-400 border border-slate-700', active: 'bg-slate-600 text-white shadow-[0_0_0.9375rem_rgba(148,163,184,0.4)]' },
};

const CategoryBadge: React.FC<CategoryBadgeProps> = ({ category, className = '', onClick, isSelected = false }) => {
  const { icon: Icon, color, active, label } = config[category];
  
  return (
    <button 
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-300 whitespace-nowrap ${isSelected ? active : color} ${className}`}
    >
      <Icon size={14} />
      {label}
    </button>
  );
};

export default CategoryBadge;