import React from 'react';
import { Users, Loader2, Clock, CheckCircle, Cigarette, Car, Building2, LayoutPanelTop as Table2, Home, Store, GraduationCap, Zap, Image as ImageIcon, X } from 'lucide-react';
import { AppInput } from './ui/CommonUI';
import DynamicListInput from './DynamicListInput';

// [A3-b1] 發團表單的「第二段」：環境設施設定／團局照片／場地特色／玩家限制。
// 從 pages/CreateGroup.tsx 原封搬出（JSX 本體逐字不變，只有縮排位移與
// `formData.features`→`features`、`formData.restrictions`→`restrictions` 兩處改名）。
// 狀態仍全部住在 CreateGroup.tsx —— 這一塊只搬 JSX，A3-c 才會真的分成兩步驟送出。

/** 照片上傳項目。唯一的定義在這裡；CreateGroup.tsx 的 state 與 handler 都 import 它。 */
export interface ImageItem {
    id: string;
    file?: File;
    preview: string;
    url?: string;
    status: 'uploading' | 'done' | 'error';
}

/** 第二段自己擁有的兩個清單欄位（DynamicListInput 那兩塊）。'rules' 屬於第一段，不在這裡。 */
export type Stage2ListField = 'features' | 'restrictions';

export interface CreateGroupStage2Props {
    // 環境設施設定：七個選項與 setter（值都是直接指定，沒有 functional update）
    venueType: string;
    setVenueType: (value: string) => void;
    skillLevel: string;
    setSkillLevel: (value: string) => void;
    smoking: string;
    setSmoking: (value: string) => void;
    parking: string[];
    setParking: (value: string[]) => void;
    elevator: string;
    setElevator: (value: string) => void;
    mahjongTable: string;
    setMahjongTable: (value: string) => void;
    tableModel: string;
    setTableModel: (value: string) => void;
    // 團局照片
    imageItems: ImageItem[];
    fileInputRef: React.RefObject<HTMLInputElement | null>;
    handleImageSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
    removeImage: (id: string) => void;
    // 場地特色／玩家限制
    features: string[];
    restrictions: string[];
    addListItem: (field: Stage2ListField) => void;
    handleListChange: (field: Stage2ListField, index: number, value: string) => void;
    removeListItem: (field: Stage2ListField, index: number) => void;
}

const CreateGroupStage2: React.FC<CreateGroupStage2Props> = ({
    venueType, setVenueType,
    skillLevel, setSkillLevel,
    smoking, setSmoking,
    parking, setParking,
    elevator, setElevator,
    mahjongTable, setMahjongTable,
    tableModel, setTableModel,
    imageItems, fileInputRef, handleImageSelect, removeImage,
    features, restrictions, addListItem, handleListChange, removeListItem
}) => (
    <>
            {/* 環境設施選項 (新增區塊) */}
            <div className="space-y-6 pt-2">
                <div className="flex items-center gap-2">
                    <div className="w-1 h-3 bg-[#c5a059] rounded-full"></div>
                    <h3 className="text-xs font-bold text-neutral-400 uppercase tracking-widest">環境設施設定</h3>
                </div>

                {/* 場館種類 - 單選 */}
                <div className="space-y-4">
                    <label className="flex items-center gap-2 text-[0.6875rem] font-bold text-neutral-400 uppercase tracking-widest ml-1">
                        <Home size="0.875rem" className="text-[#c5a059]" /> 場館種類 (選填)
                    </label>
                    <div className="grid grid-cols-3 gap-3">
                        {[
                            { label: '自家場', icon: <Home size="0.875rem" /> },
                            { label: '麻將館', icon: <Store size="0.875rem" /> },
                            { label: '代揪', icon: <Users size="0.875rem" /> }
                        ].map((opt) => (
                            <button
                                key={opt.label}
                                type="button"
                                onClick={() => setVenueType(venueType === opt.label ? '' : opt.label)}
                                className={`py-2.5 px-1 rounded-lg text-[0.8125rem] font-bold border transition-all flex flex-col items-center justify-center gap-2 ${venueType === opt.label
                                    ? 'bg-neutral-900 border-neutral-900 text-white shadow-lg'
                                    : 'bg-white border-black/[0.03] text-neutral-500 hover:border-[#c5a059]/30 shadow-sm'
                                    }`}
                            >
                                {opt.icon}
                                {opt.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* 程度 - 單選 */}
                <div className="space-y-4" >
                    <label className="flex items-center gap-2 text-[0.6875rem] font-bold text-neutral-400 uppercase tracking-widest ml-1">
                        <Zap size="0.875rem" className="text-[#c5a059]" /> 程度 (選填)
                    </label>
                    <div className="grid grid-cols-3 gap-3">
                        {[
                            { label: '快手', icon: <Zap size="0.875rem" /> },
                            { label: '中慢手', icon: <Clock size="0.875rem" /> },
                            { label: '新手', icon: <GraduationCap size="0.875rem" /> }
                        ].map((opt) => (
                            <button
                                key={opt.label}
                                type="button"
                                onClick={() => setSkillLevel(skillLevel === opt.label ? '' : opt.label)}
                                className={`py-2.5 px-1 rounded-lg text-[0.8125rem] font-bold border transition-all flex flex-col items-center justify-center gap-2 ${skillLevel === opt.label
                                    ? 'bg-neutral-900 border-neutral-900 text-white shadow-lg'
                                    : 'bg-white border-black/[0.03] text-neutral-500 hover:border-[#c5a059]/30 shadow-sm'
                                    }`}
                            >
                                {opt.icon}
                                {opt.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* 菸選項 - 單選 */}
                <div className="space-y-4" >
                    <label className="flex items-center gap-2 text-[0.6875rem] font-bold text-neutral-400 uppercase tracking-widest ml-1">
                        <Cigarette size="0.875rem" className="text-[#c5a059]" /> 菸選項 (必填)
                    </label>
                    <div className="grid grid-cols-5 gap-2">
                        {['無菸', '雀菸', '門外', '陽台', '桌上'].map((opt) => {
                            const fullOpt = opt === '門外' ? '門外菸' : opt === '陽台' ? '陽台菸' : opt === '桌上' ? '桌上菸' : opt;
                            return (
                                <button
                                    key={fullOpt}
                                    type="button"
                                    onClick={() => setSmoking(fullOpt)}
                                    className={`py-2.5 px-1 rounded-lg text-[0.75rem] font-bold border transition-all ${smoking === fullOpt
                                        ? 'bg-neutral-900 border-neutral-900 text-white shadow-md'
                                        : 'bg-white border-black/[0.02] text-neutral-400 shadow-sm'
                                        }`}
                                >
                                    {opt}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* 車位選項 - 多選 */}
                <div className="space-y-4" >
                    <label className="flex items-center gap-2 text-[0.6875rem] font-bold text-neutral-400 uppercase tracking-widest ml-1">
                        <Car size="0.875rem" className="text-[#c5a059]" /> 車位選項 (選填, 可多選)
                    </label>
                    <div className="grid grid-cols-3 gap-3">
                        {['無車位', '汽車', '機車'].map((opt) => {
                            const fullOpt = opt === '汽車' ? '汽車停車位' : opt === '機車' ? '機車停車位' : opt;
                            const isSelected = parking.includes(fullOpt);
                            return (
                                <button
                                    key={fullOpt}
                                    type="button"
                                    onClick={() => {
                                        if (fullOpt === '無車位') {
                                            setParking(['無車位']);
                                        } else {
                                            const newParking = parking.filter(p => p !== '無車位');
                                            if (newParking.includes(fullOpt)) {
                                                setParking(newParking.filter(p => p !== fullOpt));
                                            } else {
                                                setParking([...newParking, fullOpt]);
                                            }
                                        }
                                    }}
                                    className={`py-2.5 px-1 rounded-lg text-[0.8125rem] font-bold border transition-all ${isSelected
                                        ? 'bg-neutral-900 border-neutral-900 text-white shadow-lg'
                                        : 'bg-white border-black/[0.03] text-neutral-500 shadow-sm'
                                        }`}
                                >
                                    {opt}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* 電梯與桌子 (Row) */}
                <div className="grid grid-cols-2 gap-4" >
                    <div className="space-y-4">
                        <label className="flex items-center gap-2 text-[0.6875rem] font-bold text-neutral-400 uppercase tracking-widest ml-1">
                            <Building2 size="0.875rem" className="text-[#c5a059]" /> 電梯 (必填)
                        </label>
                        <div className="space-y-2">
                            {['有電梯', '無電梯', '一樓'].map((opt) => (
                                <button
                                    key={opt}
                                    type="button"
                                    onClick={() => setElevator(opt)}
                                    className={`w-full py-2.5 px-4 rounded-lg text-[0.8125rem] font-bold border text-left transition-all flex items-center justify-between ${elevator === opt
                                        ? 'bg-neutral-900 border-neutral-900 text-white shadow-md'
                                        : 'bg-white border-black/[0.02] text-neutral-500 shadow-sm'
                                        }`}
                                >
                                    {opt}
                                    {elevator === opt && <CheckCircle size="0.875rem" className="text-[#c5a059]" />}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-4">
                        <label className="flex items-center gap-2 text-[0.6875rem] font-bold text-neutral-400 uppercase tracking-widest ml-1">
                            <Table2 size="0.875rem" className="text-[#c5a059]" /> 麻將桌 (必填)
                        </label>
                        <div className="space-y-2">
                            {['電動桌', '手動桌'].map((opt) => (
                                <button
                                    key={opt}
                                    type="button"
                                    onClick={() => setMahjongTable(opt)}
                                    className={`w-full py-2.5 px-4 rounded-lg text-[0.8125rem] font-bold border text-left transition-all flex items-center justify-between ${mahjongTable === opt
                                        ? 'bg-neutral-900 border-neutral-900 text-white shadow-md'
                                        : 'bg-white border-black/[0.02] text-neutral-500 shadow-sm'
                                        }`}
                                >
                                    {opt}
                                    {mahjongTable === opt && <CheckCircle size="0.875rem" className="text-[#c5a059]" />}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* 型號輸入框 - 僅在選中電動桌時顯示 */}
                {mahjongTable === '電動桌' && (
                    <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                        <div className="relative">
                            <AppInput
                                type="text"
                                value={tableModel}
                                onChange={(e) => setTableModel(e.target.value)}
                                placeholder="手動輸入型號 (例如：商密特 E500)"
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* 照片上傳 */}
            <div className="space-y-6">
                <div className="flex items-center gap-2">
                    <div className="w-1 h-3 bg-[#c5a059] rounded-full"></div>
                    <h3 className="text-xs font-bold text-neutral-400 uppercase tracking-widest">團局照片 (選填)</h3>
                </div>

                <div className="grid grid-cols-3 gap-3">
                    {imageItems.map((item) => (
                        <div key={item.id} className="relative aspect-square rounded-lg overflow-hidden group border border-black/[0.03] shadow-sm animate-in fade-in zoom-in duration-300">
                            <img src={item.preview} alt="Preview" className={`w-full h-full object-cover ${item.status === 'uploading' ? 'opacity-50 grayscale' : ''}`} />
                            {item.status === 'uploading' && (
                                <div className="absolute inset-0 flex items-center justify-center bg-white/40 backdrop-blur-sm">
                                    <Loader2 className="text-[#c5a059] animate-spin" size="1.5rem" />
                                </div>
                            )}
                            <button
                                type="button"
                                onClick={() => removeImage(item.id)}
                                className="absolute top-2 right-2 z-10 w-7 h-7 bg-white/80 backdrop-blur-md text-neutral-800 rounded-full flex items-center justify-center hover:bg-white transition-all shadow-sm"
                            >
                                <X size="0.875rem" />
                            </button>
                        </div>
                    ))}
                    {imageItems.length < 5 && (
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="aspect-square rounded-lg bg-white border-2 border-dashed border-black/[0.03] flex flex-col items-center justify-center gap-2 text-neutral-300 hover:text-[#c5a059] hover:border-[#c5a059]/30 hover:bg-[#c5a059]/5 transition-all"
                        >
                            <ImageIcon size="1.75rem" />
                            <span className="text-[0.625rem] font-bold uppercase tracking-wider">上傳照片</span>
                        </button>
                    )}
                </div>
                <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleImageSelect}
                    accept="image/*"
                    multiple
                    className="hidden"
                />
            </div>

            <DynamicListInput
                label="場地特色 (選填)"
                items={features}
                placeholder="例如：提供飲料、有冷氣"
                onAdd={() => addListItem('features')}
                onChange={(index, value) => handleListChange('features', index, value)}
                onRemove={(index) => removeListItem('features', index)}
            />

            <DynamicListInput
                label="玩家限制 / 禁止事項 (選填)"
                items={restrictions}
                placeholder="例如：牌品不佳者勿入"
                onAdd={() => addListItem('restrictions')}
                onChange={(index, value) => handleListChange('restrictions', index, value)}
                onRemove={(index) => removeListItem('restrictions', index)}
            />
    </>
);

export default CreateGroupStage2;
