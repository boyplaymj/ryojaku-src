// pages/VenueDetail.tsx — 場地頁（[B1-j2]）。正典 PLAYER_APP_REDESIGN.md §5。
//
// 這是玩家端第一個 venue 畫面。它的難處不在版面，在**同一個「沒有地址」的畫面
// 底下有五種完全不同的原因**，而後端刻意只用「鍵在不在」表達其中一個維度：
//   granted / granted-empty / withheld-home / withheld-review / withheld-unexpected
// 判讀全部在 utils/venueView.ts（那裡有 28 條測試 ＋ 12 發突變）；
// 🔴 **本檔不可以自己寫 `if (!venue.exactAddress)`** —— 那一行會把五種合成兩種。
//
// 🔴 `?gameId=` 是自建場地址授權的憑據（後端拿它去讀那一局的 venueId 與你的報名
//    狀態）。⚠️ **目前沒有任何畫面會帶著它導到這裡**：`create-game` 從來不寫
//    `Game.VenueID`（實查 create_game/main.go），所以線上沒有任何一局綁得到場地
//    ⇒ withheld-home 那一格在今天的 App 裡**走不到**。留著這條參數不是預留，
//    是因為它是後端合約的一部分；接得起來要等「開局時選場地」那塊（§15 的 [B2]）。
//
// ✅ **本頁不顯示自建場的電話（[B5-b] 之後後端也不回了）。**
//    這一段原本寫的是「畫面上的取捨，不是修好了」—— 那句在 2026-09-09 當天是對的：
//    `venue-detail` 回的是整個 `Venue`，只有 exactAddress 被授權閘門管著，
//    phone／ownerId 對任何登入者一律回傳（實測路人拿到 `deny:no-registration`、
//    沒有 exactAddress，而 `"phone"`／`"ownerId"` 都在）。
//    **同一天後端已改成白名單型別 `shared.VenueDetailView`**（`ryojaku-src eaf2ba7`）：
//    phone／businessHours 只對 hall／event 回，`ownerId` 整個換成伺服器算的 `isOwner`。
//    ⇒ 現在是**兩層都擋**。本頁這一層留著是縱深，不是唯一那道。
//    ⚠️ 但也因此：**這一層現在沒有辦法單獨被證明有效** —— 後端不再送 phone 過來，
//    e2e 那條（V4）餵的是手寫假件，它驗的是「就算送來也不畫」。
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Loader2, MapPin, Phone, Clock, Lock } from 'lucide-react';
import { AppButton } from '../components/ui/CommonUI';
import { getVenueDetail } from '../services/apiService';
import {
    addressCopy,
    isAddressVisible,
    venueHeadline,
    venueTypeMeta,
    type VenueAddressState,
} from '../utils/venueView';
import type { VenueDetail as VenueDetailData } from '../types';

type LoadState =
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | { kind: 'ready'; venue: VenueDetailData };

/** 地址那一塊。granted 才畫真地址，其餘四種各說各的話（文案來自 utils，不在這裡寫死）。 */
const AddressBlock: React.FC<{ state: VenueAddressState; address?: string }> = ({ state, address }) => {
    if (isAddressVisible(state)) {
        return (
            <div className="flex items-start gap-2">
                <MapPin size="1rem" className="mt-0.5 shrink-0 text-[#c5a059]" />
                <p className="text-sm text-neutral-800 leading-relaxed">{address}</p>
            </div>
        );
    }
    return (
        <div className="flex items-start gap-2 rounded-lg bg-neutral-100 p-3">
            <Lock size="1rem" className="mt-0.5 shrink-0 text-neutral-400" />
            <p className="text-xs text-neutral-500 leading-relaxed">{addressCopy(state)}</p>
        </div>
    );
};

const VenueDetailPage: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const [params] = useSearchParams();
    const gameId = params.get('gameId') || undefined;
    const navigate = useNavigate();
    const [load, setLoad] = useState<LoadState>({ kind: 'loading' });

    const fetchVenue = useCallback(async (alive: () => boolean) => {
        if (!id) { setLoad({ kind: 'error', message: '網址上沒有場地 ID' }); return; }
        setLoad({ kind: 'loading' });
        try {
            const res = await getVenueDetail(id, gameId);
            if (!alive()) return;
            if (!res?.success || !res.data) {
                // 🔴 原樣顯示後端那句話：「找不到這個場地」與「查詢失敗」是**不同的**
                //    行動指示（前者不用重試，後者要）。合成一句就把那個差別丟掉了。
                setLoad({ kind: 'error', message: res?.error || '載入場地失敗，請稍後再試' });
                return;
            }
            setLoad({ kind: 'ready', venue: res.data as VenueDetailData });
        } catch (e) {
            console.error('[venue] detail failed:', e);
            if (alive()) setLoad({ kind: 'error', message: '系統發生錯誤，請稍後再試' });
        }
    }, [id, gameId]);

    useEffect(() => {
        let live = true;
        void fetchVenue(() => live);
        return () => { live = false; };
    }, [fetchVenue]);

    const Header = (
        <div className="flex items-center gap-3 px-4 pt-4">
            <button
                type="button"
                onClick={() => navigate(-1)}
                className="p-2 -ml-2 text-neutral-400 hover:text-neutral-900 transition-colors"
                aria-label="返回"
            >
                <ArrowLeft size="1.25rem" />
            </button>
            <h1 className="text-base font-black text-neutral-900">場地</h1>
        </div>
    );

    if (load.kind === 'loading') {
        return (
            <div>
                {Header}
                <div className="flex items-center justify-center gap-2 py-20 text-neutral-400 text-sm">
                    <Loader2 size="1rem" className="animate-spin" /> 載入場地資料…
                </div>
            </div>
        );
    }

    if (load.kind === 'error') {
        return (
            <div>
                {Header}
                <div className="px-4 py-16 text-center space-y-4">
                    <p className="text-sm font-bold text-neutral-600">{load.message}</p>
                    <AppButton type="button" variant="secondary" onClick={() => navigate('/venues')}>
                        看看其他場地
                    </AppButton>
                </div>
            </div>
        );
    }

    const v = load.venue;
    const head = venueHeadline(v);
    const meta = venueTypeMeta(v.type);
    // 🔴 自建場的電話不畫（見檔頭）。認不得的 type 也不畫 —— fail-closed：
    //    我們不知道那是誰的電話。
    const showPhone = meta.known && v.type !== 'home' && !!v.phone;

    return (
        <div>
            {Header}
            <div className="px-4 py-4 space-y-5 pb-12">
                <div className="space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xl" aria-hidden>{head.emoji}</span>
                        <h2 className="text-lg font-black text-neutral-900">{head.name}</h2>
                        {head.badges.map(b => (
                            <span key={b} className="rounded-full bg-[#c5a059]/15 px-2 py-0.5 text-[11px] font-bold text-[#8a6d3b]">
                                {b}
                            </span>
                        ))}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-neutral-500">
                        <span className="font-bold">{head.typeLabel}</span>
                        <span>·</span>
                        {/* §7：比例與則數一起顯示；沒人評過時是「尚無評價」而**不是** 0%。 */}
                        <span>{head.rating.text}</span>
                    </div>
                    {!meta.known && (
                        <p className="text-xs text-amber-700">
                            這個場地的分類我們認不得（{String(v.type)}），下面的資訊可能不完整。
                        </p>
                    )}
                </div>

                {/* 場地不是 active 時明講。⚠️ 這**不代表**它不會出現在別處：
                    status 目前只被地址授權讀，曝光是列表端點的事（§5.3）。 */}
                {v.status !== 'active' && (
                    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
                        <p className="text-xs text-amber-800 leading-relaxed">
                            {v.status === 'pending'
                                ? '這個場地還在審核中，資料尚未經過確認。'
                                : '這個場地目前未開放（已下架或停權）。'}
                        </p>
                    </div>
                )}

                <section className="space-y-3">
                    <h3 className="text-xs font-black text-neutral-400 tracking-wider">地點</h3>
                    {v.approxLocation?.placeName && (
                        <p className="text-sm text-neutral-600">{v.approxLocation.placeName}</p>
                    )}
                    <AddressBlock state={head.addressState} address={v.exactAddress} />
                </section>

                {(showPhone || v.businessHours) && (
                    <section className="space-y-2">
                        <h3 className="text-xs font-black text-neutral-400 tracking-wider">聯絡與時間</h3>
                        {showPhone && (
                            <a href={`tel:${v.phone}`} className="flex items-center gap-2 text-sm text-neutral-800">
                                <Phone size="1rem" className="text-[#c5a059]" />{v.phone}
                            </a>
                        )}
                        {v.businessHours && (
                            <p className="flex items-center gap-2 text-sm text-neutral-800">
                                <Clock size="1rem" className="text-[#c5a059]" />{v.businessHours}
                            </p>
                        )}
                    </section>
                )}

                {v.features && v.features.length > 0 && (
                    <section className="space-y-2">
                        <h3 className="text-xs font-black text-neutral-400 tracking-wider">場地特色</h3>
                        <div className="flex flex-wrap gap-1.5">
                            {v.features.map(f => (
                                <span key={f} className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs text-neutral-700">
                                    {f}
                                </span>
                            ))}
                        </div>
                    </section>
                )}

                {/* §7：自建場評主揪、不評場地 ⇒ 這裡刻意**不放**評價入口，
                    而不是放一顆按下去會失敗的。評價入口本身屬 [B3]。 */}
                {!meta.canRateVenue && meta.known && (
                    <p className="text-xs text-neutral-400 leading-relaxed">
                        自建場不評場地 —— 打完之後評的是主揪本人。
                    </p>
                )}
            </div>
        </div>
    );
};

export default VenueDetailPage;
