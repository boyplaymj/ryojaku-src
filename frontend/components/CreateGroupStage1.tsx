import React from 'react';
import { Clock, Coins, Home, MapPin, ChevronRight } from 'lucide-react';
import { AppInput } from './ui/CommonUI';
import DynamicListInput from './DynamicListInput';

// [A3-b2] 發團表單的「第一段」：團局種類／開始時間／缺幾人與籌碼／麻將規則／地點資訊。
// 從 pages/CreateGroup.tsx 原封搬出（JSX 本體逐字不變，只有縮排位移與機械式改名：
// `formData.X`→`X`、`setFormData({ ...formData, X: v })`→`setX(v)`、
// `setShowDatePicker(true)`→`openDatePicker()`、`setIsMapOpen(true)`→`openMap()`）。
// 狀態與 DatePicker／MapPicker 這兩個 modal 仍全部住在 CreateGroup.tsx ——
// 這一塊只搬 JSX，A3-c 才會真的分成兩步驟送出。

/** 第一段自己擁有的清單欄位（麻將規則那塊）。'features'／'restrictions' 屬於第二段，不在這裡。 */
export type Stage1ListField = 'rules';

export interface CreateGroupStage1Props {
    // 開始時間：只顯示，點了叫父層打開 DatePicker
    startTime: string;
    openDatePicker: () => void;
    // 缺幾人／籌碼（setter 的語意＝父層原本的 setFormData({ ...formData, X: v })）
    needPlayers: number;
    setNeedPlayers: (value: number) => void;
    stakes: string;
    setStakes: (value: string) => void;
    // 麻將規則
    rules: string[];
    addListItem: (field: Stage1ListField) => void;
    handleListChange: (field: Stage1ListField, index: number, value: string) => void;
    removeListItem: (field: Stage1ListField, index: number) => void;
    // 地點資訊：場地名稱可編輯；地址與座標只顯示，點了叫父層打開 MapPicker
    placeName: string;
    setPlaceName: (value: string) => void;
    location: string;
    coordinates: { latitude: number; longitude: number };
    openMap: () => void;
}

const CreateGroupStage1: React.FC<CreateGroupStage1Props> = ({
    startTime, openDatePicker,
    needPlayers, setNeedPlayers,
    stakes, setStakes,
    rules, addListItem, handleListChange, removeListItem,
    placeName, setPlaceName,
    location, coordinates, openMap
}) => (
    <>
            {/* Type Selection (Simplified) */}
            <div className="space-y-2">
                <label className="text-[0.6875rem] font-bold text-neutral-400 uppercase tracking-widest ml-1">團局種類</label>
                <div className="flex gap-2">
                    <div className="px-4 py-2.5 rounded-lg text-[0.8125rem] font-bold bg-neutral-900 text-white shadow-md">
                        ⚡ 臨時揪團
                    </div>
                </div>
            </div>

            {/* Basic Info */}
            <div className="space-y-5">
                <div className="space-y-2">
                    <label className="block text-[0.6875rem] font-bold text-neutral-400 uppercase tracking-widest ml-1">開始時間</label>
                    <div
                        className="relative bg-white border border-black/[0.03] rounded-lg p-3.5 shadow-sm transition-all active:bg-neutral-50"
                        onClick={() => openDatePicker()}
                    >
                        <Clock size="1.25rem" className="absolute left-4 top-1/2 -translate-y-1/2 text-[#c5a059]" />
                        <div className="w-full bg-transparent pl-10 text-[1.0625rem] text-neutral-900 font-bold tracking-tight cursor-pointer">
                            {(() => {
                                const d = new Date(startTime);
                                const dateStr = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
                                let h = d.getHours();
                                const m = d.getMinutes();
                                const period = h >= 12 ? 'PM' : 'AM';
                                if (h > 12) h -= 12;
                                if (h === 0) h = 12;
                                const timeStr = `${h}:${String(m).padStart(2, '0')} ${period}`;
                                return `${dateStr} ${timeStr}`;
                            })()}
                        </div>
                    </div>
                </div>
            </div>

            {/* Row 2: Players & Stakes */}
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <label className="block text-[0.6875rem] font-bold text-neutral-400 uppercase tracking-widest ml-1">缺幾人</label>
                    <div className="flex bg-white border border-black/[0.03] rounded-lg p-1 shadow-sm h-[3.25rem]">
                        {[1, 2, 3].map((num) => (
                            <button
                                key={num}
                                type="button"
                                onClick={() => setNeedPlayers(num)}
                                className={`flex-1 flex items-center justify-center rounded-lg text-sm font-bold transition-all ${needPlayers === num
                                    ? 'bg-neutral-900 shadow-md text-white'
                                    : 'text-neutral-400 hover:text-neutral-600'
                                    }`}
                            >
                                {num}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="space-y-2">
                    <label className="block text-[0.6875rem] font-bold text-neutral-400 uppercase tracking-widest ml-1">籌碼</label>
                    <AppInput
                        required
                        value={stakes}
                        onChange={(e) => setStakes(e.target.value)}
                        placeholder="100/20"
                        icon={Coins}
                    />
                </div>
            </div>

            {/* Mahjong Rules & Dynamic List */}
            <DynamicListInput
                label="麻將規則"
                items={rules}
                placeholder="例如：不打請提前告知場主"
                onAdd={() => addListItem('rules')}
                onChange={(index, value) => handleListChange('rules', index, value)}
                onRemove={(index) => removeListItem('rules', index)}
            />

            {/* Location Section */}
            <div className="space-y-5">
                <div className="flex items-center gap-2">
                    <div className="w-1 h-3 bg-[#c5a059] rounded-full"></div>
                    <h3 className="text-xs font-bold text-neutral-400 uppercase tracking-widest">地點資訊</h3>
                </div>


                <div className="space-y-2">
                    <label className="block text-[0.6875rem] font-bold text-neutral-400 uppercase tracking-widest ml-1">場地名稱</label>
                    <AppInput
                        required
                        value={placeName}
                        onChange={(e) => setPlaceName(e.target.value)}
                        placeholder="例如：台北信義 / 自家場"
                        icon={Home}
                    />
                </div>

                <div className="space-y-2">
                    <label className="block text-[0.6875rem] font-bold text-neutral-400 uppercase tracking-widest ml-1">定位地點</label>
                    <button
                        type="button"
                        onClick={() => openMap()}
                        className={`w-full flex items-center justify-between p-3.5 rounded-lg border transition-all ${location
                            ? 'bg-white border-black/[0.03] shadow-sm'
                            : 'bg-[#c5a059]/5 border-[#c5a059]/10'
                            }`}
                    >
                        <div className="flex items-center gap-4 overflow-hidden text-left">
                            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${location ? 'bg-neutral-50 text-[#c5a059]' : 'bg-[#c5a059] text-white shadow-lg shadow-[#c5a059]/20'}`}>
                                <MapPin size="1.25rem" />
                            </div>
                            <div className="overflow-hidden">
                                {location ? (
                                    <>
                                        <p className="text-[0.9375rem] text-neutral-900 font-bold truncate">{location}</p>
                                        <p className="text-[0.6875rem] text-neutral-400 font-medium mt-0.5">
                                            {coordinates.latitude.toFixed(4)}, {coordinates.longitude.toFixed(4)}
                                        </p>
                                    </>
                                ) : (
                                    <>
                                        <p className="text-[0.9375rem] text-[#c5a059] font-bold">點擊開啟地圖</p>
                                        <p className="text-[0.6875rem] text-[#c5a059]/60 font-medium mt-0.5">選擇團局具體座標位置</p>
                                    </>
                                )}
                            </div>
                        </div>
                        <ChevronRight size="1.25rem" className="text-neutral-300 shrink-0 ml-2" />
                    </button>
                </div>
            </div>
    </>
);

export default CreateGroupStage1;
