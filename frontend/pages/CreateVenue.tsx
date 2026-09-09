// pages/CreateVenue.tsx — 登錄場地（[B1-j4]）。正典 PLAYER_APP_REDESIGN.md §5。
//
// 🔴 送出後的 `status` **由後端依 type 決定**，前端不預測：
//    hall → `pending`（要人審，後台 ryojaku-console）／home → `active`。
//    ⇒ 成功畫面讀回應裡的 status，不是照著我們以為的規則講。
//    ⚠️ 麻將館建完之後**功能是壞的直到有人去審**（他自己看得到地址，玩家拿不到），
//    所以那句話一定要講出來 —— 建立者不會自己發現。
//
// 🔴 **自建場的座標會先位移 300–500 公尺再送出**（§5.1），位移邏輯與尺在
//    utils/venueLocation.ts。⚠️ 那是**客戶端自律不是強制**：後端收到什麼就存什麼
//    （實查：`ApproxLocation: r.ApproxLocation`，全 backend 零 blur）。
//
// 🔴 這一頁**不給選「活動場」**（§5.1：官方建的）。⚠️ 但後端的 Validate **收** event
//    ⇒ 這是畫面上的限制，不是規則。兩者的差別記在設計冊 §5.3。
//
// ⚠️ 這一頁會開 MapPicker（Amazon Location Service，**按圖磚計費**，§9）。
//    這是 App 裡第二個會載圖磚的畫面（第一個是建局表單）。它只在使用者主動點
//    「選位置」時才掛載，不在頁面一打開就載。
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, MapPin } from 'lucide-react';
import MapPicker from '../components/MapPicker';
import { AppButton, AppInput } from '../components/ui/CommonUI';
import { useToast } from '../contexts/ToastContext';
import { createVenue } from '../services/apiService';
import { validateCreateVenue, venueTypeMeta, CREATABLE_VENUE_TYPES } from '../utils/venueView';
import { locationForSubmit } from '../utils/venueLocation';
import type { CreateVenuePayload, VenueType } from '../types';

const TYPE_HINT: Record<string, string> = {
    hall: '營業中的麻將館。地址會公開給所有登入的玩家，並且需要經過審核才會上線。',
    home: '自己家或私人場地。地圖上只顯示大概位置，完整地址只有你核准報名的人看得到。',
};

const CreateVenuePage: React.FC = () => {
    const navigate = useNavigate();
    const { showToast } = useToast();

    const [type, setType] = useState<VenueType | ''>('');
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [businessHours, setBusinessHours] = useState('');
    const [address, setAddress] = useState('');
    const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
    const [isMapOpen, setIsMapOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [done, setDone] = useState<{ venueId: string; status: string } | null>(null);

    const handleLocationConfirm = (loc: { address: string; lat: number; lng: number }) => {
        setCoords({ lat: loc.lat, lng: loc.lng });
        // 🔴 只在使用者還沒自己打過地址時才用反查回來的那串 —— 覆蓋掉他打的字
        //    會讓「我明明改過」變成靜靜被丟掉。
        setAddress(prev => (prev.trim() === '' ? loc.address : prev));
        setIsMapOpen(false);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const err = validateCreateVenue({
            type, name,
            latitude: coords?.lat, longitude: coords?.lng,
            exactAddress: address,
        });
        if (err) { showToast(err, 'warning'); return; }

        // 到這裡 coords 一定非 null（validateCreateVenue 擋掉了），斷言只是給 TS 看。
        const exact = { latitude: coords!.lat, longitude: coords!.lng };
        const loc = locationForSubmit(type, exact, name);

        const payload: CreateVenuePayload = {
            type: type as VenueType,
            name: name.trim(),
            approxLocation: loc.approxLocation,
            ...(address.trim() ? { exactAddress: address.trim() } : {}),
            ...(phone.trim() ? { phone: phone.trim() } : {}),
            ...(businessHours.trim() ? { businessHours: businessHours.trim() } : {}),
        };

        setIsSaving(true);
        try {
            const res = await createVenue(payload);
            if (!res?.success || !res.data) {
                // 後端那幾句話是不同的行動指示，原樣顯示。
                showToast(res?.error || '建立場地失敗，請稍後再試', 'error');
                return;
            }
            const created = res.data as { venueId: string; status: string };
            setDone({ venueId: created.venueId, status: created.status });
        } catch (e2) {
            console.error('[venue] create failed:', e2);
            showToast('系統發生錯誤，請稍後再試', 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const Header = (
        <div className="flex items-center gap-3 px-4 pt-4">
            <button
                type="button"
                onClick={() => navigate('/venues')}
                className="p-2 -ml-2 text-neutral-400 hover:text-neutral-900 transition-colors"
                aria-label="返回場地列表"
            >
                <ArrowLeft size="1.25rem" />
            </button>
            <h1 className="text-base font-black text-neutral-900">登錄場地</h1>
        </div>
    );

    if (done) {
        // 🔴 講的是**回應裡的 status**，不是我們以為的規則。
        const pending = done.status === 'pending';
        return (
            <div>
                {Header}
                <div className="px-4 py-14 text-center space-y-4">
                    <p className="text-lg font-black text-neutral-900">場地已建立</p>
                    {pending ? (
                        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-left space-y-2">
                            <p className="text-sm font-black text-amber-800">目前是「待審核」</p>
                            <p className="text-xs text-amber-800 leading-relaxed">
                                審核通過之前，這個場地<span className="font-bold">不會出現在公開列表</span>，
                                而且<span className="font-bold">玩家拿不到你填的地址</span> ——
                                你自己看得到，所以從你這邊看起來會像一切正常。
                            </p>
                        </div>
                    ) : (
                        <p className="text-sm text-neutral-600">已經可以使用了。</p>
                    )}
                    <div className="space-y-2 pt-2">
                        <AppButton type="button" className="w-full" onClick={() => navigate(`/venue/${encodeURIComponent(done.venueId)}`)}>
                            看看這個場地
                        </AppButton>
                        <AppButton type="button" variant="secondary" className="w-full" onClick={() => navigate('/venues')}>
                            回場地列表
                        </AppButton>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div>
            {Header}
            <form onSubmit={handleSubmit} className="px-4 py-4 space-y-5 pb-12">
                <div className="space-y-2">
                    <label className="text-xs font-black text-neutral-400 tracking-wider">場地類型（必填）</label>
                    <div className="grid grid-cols-2 gap-2">
                        {CREATABLE_VENUE_TYPES.map(t => {
                            const meta = venueTypeMeta(t);
                            const active = type === t;
                            return (
                                <button
                                    key={t}
                                    type="button"
                                    onClick={() => setType(t)}
                                    aria-pressed={active}
                                    className={`rounded-lg border p-3 text-left transition-colors ${active
                                        ? 'border-[#c5a059] bg-[#c5a059]/[0.08]'
                                        : 'border-black/[0.06] bg-white'}`}
                                >
                                    <span className="text-sm font-black text-neutral-900">{meta.emoji} {meta.label}</span>
                                </button>
                            );
                        })}
                    </div>
                    {type && <p className="text-[11px] text-neutral-500 leading-relaxed">{TYPE_HINT[type]}</p>}
                    <p className="text-[11px] text-neutral-400">活動場由官方建立，這裡不提供。</p>
                </div>

                <AppInput label="場地名稱（必填）" value={name} onChange={e => setName(e.target.value)} placeholder="例：大安麻將館" />

                <div className="space-y-2">
                    <label className="text-xs font-black text-neutral-400 tracking-wider">位置（必填）</label>
                    <button
                        type="button"
                        onClick={() => setIsMapOpen(true)}
                        className="w-full flex items-center gap-2 rounded-lg border border-black/[0.06] bg-white p-3 text-left"
                    >
                        <MapPin size="1rem" className="text-[#c5a059]" />
                        <span className="text-sm text-neutral-700">
                            {coords ? `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}` : '在地圖上選一個位置'}
                        </span>
                    </button>
                    {type === 'home' && (
                        <p className="text-[11px] text-neutral-500 leading-relaxed">
                            自建場放到地圖上時會<span className="font-bold">先隨機位移 300～500 公尺</span>，
                            不會直接標出你家。完整地址只有你核准報名的人看得到。
                        </p>
                    )}
                </div>

                <AppInput
                    label={type === 'home' ? '完整地址（必填，只給核准的玩家）' : '完整地址'}
                    value={address}
                    onChange={e => setAddress(e.target.value)}
                    placeholder="例：台北市大安區某某路 100 號 5 樓"
                />

                {type === 'hall' && (
                    <>
                        <AppInput label="電話" value={phone} onChange={e => setPhone(e.target.value)} placeholder="例：02-1234-5678" />
                        <AppInput label="營業時間" value={businessHours} onChange={e => setBusinessHours(e.target.value)} placeholder="例：每日 12:00–02:00" />
                    </>
                )}

                <div className="pt-4 space-y-3">
                    <AppButton type="submit" isLoading={isSaving} className="w-full">建立場地</AppButton>
                    <AppButton type="button" variant="secondary" className="w-full" onClick={() => navigate('/venues')}>
                        取消
                    </AppButton>
                </div>
            </form>

            {/* 🔴 只在打開時才掛載 —— MapPicker 一掛上去就開始抓圖磚（計費，§9）。 */}
            {isMapOpen && (
                <MapPicker
                    isOpen={isMapOpen}
                    onClose={() => setIsMapOpen(false)}
                    onConfirm={handleLocationConfirm}
                    initialLat={coords?.lat}
                    initialLng={coords?.lng}
                />
            )}
        </div>
    );
};

export default CreateVenuePage;
