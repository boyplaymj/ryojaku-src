import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MapPin, X, Navigation, Check, Loader2, AlertCircle } from 'lucide-react';
import { Amplify } from 'aws-amplify';
import { Geo } from '@aws-amplify/geo';
import { createMap } from 'maplibre-gl-js-amplify';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
    TAIWAN_MAX_BOUNDS,
    MAP_MIN_ZOOM,
    MAP_MAX_ZOOM,
    MAP_DEFAULT_ZOOM,
    isWithinMapBounds,
    shouldReverseGeocode,
    type LatLng,
} from '../utils/mapCost';

// Configure Amplify v6
Amplify.configure({
    Auth: {
        Cognito: {
            identityPoolId: 'ap-northeast-1:adc7f1f2-86da-4cb4-80de-594f67967b7f',
            allowGuestAccess: true
        }
    },
    Geo: {
        LocationService: {
            maps: {
                items: {
                    MahjongClubMap: {
                        style: 'VectorHereExplore'
                    }
                },
                default: 'MahjongClubMap'
            },
            searchIndices: {
                items: ['MahjongClubPlaceIndex'],
                default: 'MahjongClubPlaceIndex'
            },
            region: 'ap-northeast-1',
        }
    }
});

interface MapPickerProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (location: { address: string; lat: number; lng: number }) => void;
    initialLat?: number;
    initialLng?: number;
}

const MapPicker: React.FC<MapPickerProps> = ({
    isOpen,
    onClose,
    onConfirm,
    initialLat = 25.033976, // Taipei 101 as default
    initialLng = 121.564421
}) => {
    const mapContainerRef = useRef<HTMLDivElement>(null);
    const mapInstance = useRef<maplibregl.Map | null>(null);
    const [address, setAddress] = useState<string>('正在取得地址...');
    const [coords, setCoords] = useState<{ lat: number; lng: number }>({ lat: initialLat, lng: initialLng });
    const [isReverseGeocoding, setIsReverseGeocoding] = useState(false);
    const [isMoving, setIsMoving] = useState(false);
    const [isUserTyping, setIsUserTyping] = useState(false);
    const [addressError, setAddressError] = useState<string>('');
    const [isVerifying, setIsVerifying] = useState(false);

    // Remove searchTimeout as we are moving to manual search
    const isProgrammaticMove = useRef(false);

    /**
     * 上一次**真的送出去問過**的座標（[C1]，§9）。
     * 🔴 不可以拿 `coords` 代替 —— `coords` 每一幀 `move` 都在更新，
     *    它是「現在指到哪」，而這裡要的是「上次花錢問的是哪一點」。
     */
    const lastGeocodedRef = useRef<LatLng | null>(null);

    useEffect(() => {
        let map: maplibregl.Map;

        const initializeMap = async () => {
            if (isOpen && mapContainerRef.current && !mapInstance.current) {
                try {
                    map = await createMap({
                        container: mapContainerRef.current,
                        center: [initialLng, initialLat],
                        zoom: MAP_DEFAULT_ZOOM,
                        bearing: 0,
                        pitch: 0,
                        // [C1] 地圖成本止血（§9.2）。這三個選項由 createMap 原封不動
                        // 轉交給 maplibregl.Map —— 實查 maplibre-gl-js-amplify 的
                        // createMapLibreMap()：它只抽掉 region／mapConstructor，其餘展開。
                        maxBounds: TAIWAN_MAX_BOUNDS,
                        minZoom: MAP_MIN_ZOOM,
                        maxZoom: MAP_MAX_ZOOM,
                    });
                    mapInstance.current = map;

                    // Add navigation control
                    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

                    map.on('movestart', () => {
                        setIsMoving(true);
                        setIsVerifying(false);
                        setAddressError('');
                    });

                    map.on('move', () => {
                        const center = map.getCenter();
                        setCoords({ lat: center.lat, lng: center.lng });
                    });

                    map.on('moveend', () => {
                        setIsMoving(false);
                        if (isProgrammaticMove.current) {
                            isProgrammaticMove.current = false;
                            return;
                        }
                        const center = map.getCenter();
                        // [C1] 沒移動多少就不必再花一次 Places 請求（§9，shouldReverseGeocode）。
                        // ⚠️ 它 fail-open：沒問過就一定問，所以第一次一定會進去。
                        if (!shouldReverseGeocode(lastGeocodedRef.current, { lat: center.lat, lng: center.lng })) {
                            return;
                        }
                        reverseGeocode(center.lat, center.lng);
                    });

                    // Initial geocode
                    reverseGeocode(initialLat, initialLng);

                    // If using default Taipei 101 coordinates, try to get user location
                    if (initialLat === 25.033976 && initialLng === 121.564421) {
                        navigator.geolocation?.getCurrentPosition((position) => {
                            const { latitude, longitude } = position.coords;
                            if (!mapInstance.current) return;

                            // [C1] 框外不要飛過去（§9，isWithinMapBounds）。
                            // maxBounds 會把 flyTo 的目標**默默夾到邊界**，而我們接著會對
                            // 那個被夾過的座標問地址 ⇒ 畫面上出現一個他從沒去過的地點，
                            // 沒有任何錯誤訊息。⇒ 寧可留在預設的台北。
                            if (!isWithinMapBounds({ lat: latitude, lng: longitude })) return;

                            // 🔴 旗標要**留著**讓 moveend 去消耗，不可以在這裡同步關掉。
                            //    flyTo 是動畫，moveend 在動畫結束時才觸發；原本的寫法
                            //    在同一個 tick 就把旗標設回 false ⇒ moveend 不會提早返回，
                            //    於是**同一個座標被問了兩次地址**（一次這裡、一次 moveend）。
                            //    對照組就在本檔裡：forwardGeocode() 設了 true 之後沒有關，那個是對的。
                            isProgrammaticMove.current = true;
                            mapInstance.current.flyTo({ center: [longitude, latitude], zoom: MAP_DEFAULT_ZOOM });
                            reverseGeocode(latitude, longitude);
                        });
                    }
                } catch (error) {
                    console.error('Error initializing map:', error);
                }
            }
        };

        initializeMap();

        return () => {
            if (mapInstance.current) {
                mapInstance.current.remove();
                mapInstance.current = null;
            }
        };
    }, [isOpen]);

    const reverseGeocode = async (lat: number, lng: number) => {
        // [C1] 記在送出**之前**：失敗了也算問過這一點，否則同一點會一直重試重花錢。
        lastGeocodedRef.current = { lat, lng };
        setIsReverseGeocoding(true);
        setAddressError('');
        try {
            const place = await Geo.searchByCoordinates([lng, lat], { maxResults: 1 });

            if (place) {
                let formattedAddress = place.label || '';
                if (!formattedAddress) {
                    const parts = [];
                    if (place.region) parts.push(place.region);
                    if (place.subRegion) parts.push(place.subRegion);
                    if (place.municipality) parts.push(place.municipality);
                    if (place.neighborhood) parts.push(place.neighborhood);
                    if (place.street) parts.push(place.street);
                    if (place.addressNumber) parts.push(place.addressNumber + '號');
                    formattedAddress = parts.join('');
                }
                setAddress(formattedAddress || '未知地點');
                setIsUserTyping(false); // System update, valid state
            } else {
                setAddress('未知地點');
                setIsUserTyping(false); // Even if unknown, it's not user typing
            }
        } catch (error) {
            console.error('Reverse geocoding failed:', error);
            setAddress('解析地址失敗');
            setIsUserTyping(false);
        } finally {
            setIsReverseGeocoding(false);
        }
    };

    const performGeocode = async (query: string) => {
        try {
            const results = await Geo.searchByText(query, { maxResults: 1 });
            return results;
        } catch (error) {
            console.error('Geocoding fetch failed:', error);
            return null;
        }
    };

    const handleManualSearch = () => {
        forwardGeocode(address);
    };

    const forwardGeocode = async (query: string) => {
        if (!query || query.length < 2) {
            setIsVerifying(false);
            return;
        }

        setIsVerifying(true); // Start verification
        setIsReverseGeocoding(true); // Show loading

        try {
            let results = await performGeocode(query);

            let isFallback = false;
            if (!results || results.length === 0) {
                const fallbackQuery = query.replace(/\d+號/, '');
                if (fallbackQuery !== query && fallbackQuery.length > 3) {
                    console.log('Attempting fallback geocode:', fallbackQuery);
                    results = await performGeocode(fallbackQuery);
                    isFallback = true;
                }
            }

            if (results && results.length > 0) {
                const place = results[0];
                const [longitude, latitude] = place.geometry!.point;

                if (mapInstance.current) {
                    isProgrammaticMove.current = true;
                    mapInstance.current.flyTo({ center: [longitude, latitude], zoom: MAP_DEFAULT_ZOOM });
                    setCoords({ lat: latitude, lng: longitude });
                }

                if (isFallback) {
                    setAddressError('找不到精確門牌，已定位至該街道，請手動微調位置');
                } else {
                    setAddressError('');
                }
                setIsUserTyping(false); // Verification complete, valid state
            } else {
                setAddressError('無法識別此地址，請檢查輸入或直接在地圖上選擇');
                // Keep isUserTyping true or invalid state so confirm is disabled
            }
        } catch (error) {
            console.error('Forward geocoding failed:', error);
            setAddressError('地址搜尋發生錯誤，請稍後再試');
        } finally {
            setIsReverseGeocoding(false);
            setIsVerifying(false);
        }
    };

    const handleAddressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newAddress = e.target.value;
        setAddress(newAddress);
        setAddressError('');
        setIsUserTyping(true); // User is typing, disable confirm
        setIsVerifying(false);
    };

    const handleCurrentLocation = () => {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition((position) => {
                const { latitude, longitude } = position.coords;
                if (!mapInstance.current) return;

                // [C1] 同上的夾邊界問題。差別是**這一條路是使用者主動按的** ——
                // 開圖時的自動定位不動作沒人會發現，按鈕不動作會被讀成「壞了」，
                // 所以這裡要講話。
                if (!isWithinMapBounds({ lat: latitude, lng: longitude })) {
                    setAddressError('目前位置不在服務範圍內，請直接在地圖上選擇');
                    return;
                }

                // ⚠️ 這裡**刻意不設** isProgrammaticMove：使用者要的就是「跳到我這裡並更新地址」，
                //    地址由隨後的 moveend 去問（那一次也會過 shouldReverseGeocode 的距離閘）。
                mapInstance.current.flyTo({ center: [longitude, latitude], zoom: MAP_DEFAULT_ZOOM });
            });
        }
    };

    if (!isOpen) return null;

    return createPortal(
        <div className="fixed inset-0 z-[9999] flex flex-col bg-[#f9f9f7] touch-none overscroll-none">
            {/* Header */}
            {/* Header - Standardized */}
            <div className="bg-white border-b border-black/[0.03] shrink-0 pt-safe">
                <div className="h-16 px-4 flex items-center justify-between">
                    <button
                        onClick={onClose}
                        className="w-10 h-10 flex items-center justify-center rounded-lg bg-neutral-50 text-neutral-400 hover:text-neutral-900 transition-all active:scale-95"
                    >
                        <X size="1.5rem" />
                    </button>
                    <h2 className="text-[1.0625rem] font-bold text-neutral-900 tracking-tight">選擇地點</h2>
                    <div className="w-10" /> {/* Spacer */}
                </div>
            </div>

            {/* Map Container */}
            <div className="relative flex-1 bg-neutral-100 overflow-hidden">
                <div ref={mapContainerRef} className="w-full h-full" />

                {/* Center Pin (Uber Style) - Minimal Lux Gold version */}
                <div className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full pointer-events-none z-[1000] transition-transform duration-200 ${isMoving ? '-translate-y-[120%] scale-110' : ''}`}>
                    <div className="relative">
                        <MapPin size="2.75rem" className="text-[#c5a059] fill-[#c5a059]/10 drop-shadow-md" />
                        {/* Shadow under pin */}
                        <div className={`absolute -bottom-1 left-1/2 -translate-x-1/2 w-3 h-1 bg-black/20 rounded-full blur-[0.125rem] transition-all duration-200 ${isMoving ? 'scale-150 opacity-10' : 'scale-100 opacity-40'}`} />
                    </div>
                </div>

                {/* Current Location Button */}
                <button
                    onClick={handleCurrentLocation}
                    className="absolute bottom-6 right-4 w-12 h-12 flex items-center justify-center bg-white border border-black/[0.03] rounded-full text-[#c5a059] shadow-lg z-[1000] active:scale-90 transition-transform hover:bg-[#c5a059]/5"
                >
                    <Navigation size="1.375rem" />
                </button>
            </div>

            {/* Bottom Info Panel */}
            <div className="p-6 pb-safe bg-white border-t border-black/[0.03] space-y-4 shrink-0 shadow-[0_-0.25rem_1.25rem_rgba(0,0,0,0.02)]">
                <div className="space-y-2">
                    <label className="text-[0.6875rem] font-bold text-neutral-400 uppercase tracking-widest ml-1">選定地址</label>
                    <div className="flex gap-2">
                        <div className={`flex-1 flex items-center gap-3 bg-neutral-50 p-3.5 rounded-lg border transition-colors ${addressError ? 'border-red-200' : 'border-black/[0.02]'}`}>
                            <div className="shrink-0">
                                <MapPin size="1.125rem" className={addressError ? 'text-red-500' : 'text-[#c5a059]'} />
                            </div>
                            <input
                                type="text"
                                value={address}
                                onChange={handleAddressChange}
                                placeholder="輸入地址或移動地圖..."
                                className={`w-full bg-transparent text-sm font-medium placeholder:text-neutral-300 focus:outline-none ${addressError ? 'text-red-500' : 'text-neutral-900'}`}
                            />
                        </div>
                        {isUserTyping && (
                            <button
                                onClick={handleManualSearch}
                                disabled={isVerifying || !address}
                                className="px-5 bg-neutral-900 text-white rounded-lg font-bold text-sm transition-all active:scale-95 disabled:opacity-50"
                            >
                                {isVerifying ? <Loader2 size="1.125rem" className="animate-spin" /> : '定位'}
                            </button>
                        )}
                    </div>
                    {addressError && (
                        <div className="flex items-center gap-2 px-1">
                            <AlertCircle size="0.875rem" className="text-red-500" />
                            <span className="text-[0.6875rem] text-red-500 font-medium">{addressError}</span>
                        </div>
                    )}
                </div>

                <button
                    onClick={() => onConfirm({ address, lat: coords.lat, lng: coords.lng })}
                    disabled={isMoving || isReverseGeocoding || isVerifying || !!addressError || !address || isUserTyping}
                    className="w-full bg-[#c5a059] text-white font-bold py-4 rounded-lg shadow-lg active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:bg-neutral-100 disabled:text-neutral-300 disabled:shadow-none disabled:cursor-not-allowed"
                >
                    {isUserTyping ? (
                        <>請先點擊定位確認地址</>
                    ) : (
                        <>
                            <Check size="1.25rem" />
                            確認此位置
                        </>
                    )}
                </button>
            </div>
        </div>,
        document.body
    );
};

export default MapPicker;
