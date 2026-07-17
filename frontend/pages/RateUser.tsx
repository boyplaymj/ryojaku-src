import React, { useState, useEffect } from 'react';
import { useToast } from '../contexts/ToastContext';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, ThumbsUp, ThumbsDown, MapPin, Clock } from 'lucide-react';
import { getUserInfo, getGameDetail, submitRating } from '../services/apiService';
import { authService } from '../services/authService';

interface UserInfo {
  userId: string;
  displayName: string;
  pictureUrl?: string;
}

interface GameData {
  gameId: string;
  location: {
    placeName: string;
    address: string;
  };
  gameInfo: {
    startTime: string;
  };
}

const RateUser: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [targetUser, setTargetUser] = useState<UserInfo | null>(null);
  const [game, setGame] = useState<GameData | null>(null);
  const [isPositive, setIsPositive] = useState<boolean | null>(null);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const { showToast } = useToast();

  const gameId = searchParams.get('gameId');
  const toUserId = searchParams.get('toUserId');

  useEffect(() => {
    loadData();
  }, [gameId, toUserId]);

  const loadData = async () => {
    if (!gameId || !toUserId) {
      showToast('缺少必要參數', 'error');
      navigate(-1);
      return;
    }

    const currentUser = authService.getCurrentUser();
    if (!currentUser) {
      showToast('請先登入', 'error');
      navigate('/');
      return;
    }

    try {
      setLoading(true);

      // Get game details
      const gameResponse = await getGameDetail(gameId);
      if (gameResponse.success && gameResponse.data?.game) {
        setGame(gameResponse.data.game);
      }

      // Get target user info
      const userResponse = await getUserInfo(toUserId);
      if (userResponse.success && userResponse.data) {
        setTargetUser(userResponse.data);
      }

    } catch (error) {
      console.error('Load data error:', error);
      showToast('載入失敗,請稍後再試', 'error');
      navigate(-1);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (isPositive === null) {
      showToast('請選擇好評或差評', 'warning');
      return;
    }

    if (comment.trim().length < 5) {
      showToast('評論內容至少需要 5 個字', 'warning');
      return;
    }

    const currentUser = authService.getCurrentUser();
    if (!currentUser || !gameId || !toUserId) return;

    setSubmitting(true);
    try {
      const response = await submitRating(currentUser.userId, {
        gameId,
        toUserId,
        isPositive,
        comment: comment.trim()
      });

      if (response.success) {
        showToast('評分成功！', 'success');
        setTimeout(() => navigate(-1), 1500);
      } else {
        showToast(response.error || '評分失敗', 'error');
      }
    } catch (error) {
      console.error('Submit error:', error);
      showToast('提交失敗,請稍後再試', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] gap-4 bg-[#f9f9f7]">
        <div className="animate-spin rounded-full h-10 w-10 border-[0.1875rem] border-neutral-100 border-t-[#c5a059]"></div>
        <p className="text-[0.625rem] font-black text-neutral-300 uppercase tracking-[0.3em] animate-pulse">正在準備評分系統...</p>
      </div>
    );
  }

  if (!targetUser || !game) {
    return (
      <div className="flex items-center justify-center min-h-screen p-4 bg-[#f9f9f7]">
        <div className="text-center bg-white p-10 rounded-lg border border-black/[0.03] shadow-sm max-w-xs w-full">
          <p className="text-neutral-400 font-black text-[0.8125rem] uppercase tracking-widest mb-6">資料異常，無法評分</p>
          <button
            onClick={() => navigate(-1)}
            className="w-full py-4 bg-neutral-900 text-white rounded-lg text-[0.6875rem] font-black uppercase tracking-[0.2em] shadow-md transition-all active:scale-95"
          >
            返回上一頁
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#f9f9f7] min-h-screen animate-fade-in pt-safe">
      {/* Header - Minimal Lux */}
      {/* Header - Standardized EventDetail Style (4rem height) */}
      <div className="h-16 px-4 flex items-center mb-2">
        <div className="flex items-center gap-4 w-full">
          <button
            onClick={() => navigate(-1)}
            className="w-10 h-10 rounded-lg bg-white flex items-center justify-center text-neutral-400 hover:text-neutral-900 shadow-sm border border-black/[0.03] transition-all active:scale-90"
          >
            <ArrowLeft size="1.25rem" />
          </button>
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-1">
              <span className="text-[0.625rem] font-black text-[#c5a059] uppercase tracking-[0.2em]">PLAYER FEEDBACK</span>
              <div className="h-[0.0625rem] flex-1 bg-black/[0.03]"></div>
            </div>
            <div className="flex items-center gap-2">
              <p className="text-[0.6875rem] font-black text-neutral-400 bg-neutral-100 px-3 py-1 rounded-full border border-black/[0.02]">
                評分系統
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="px-6 space-y-4">
        {/* Target User Card - Minimal Lux */}
        <div className="bg-white border border-black/[0.04] rounded-lg p-6 shadow-sm overflow-hidden relative">
          <div className="absolute top-0 right-0 w-32 h-32 bg-[#c5a059]/[0.02] rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none"></div>
          <div className="flex items-center gap-5 relative z-10">
            <div className="w-16 h-16 rounded-lg bg-neutral-900 flex items-center justify-center text-[#c5a059] font-black text-2xl shadow-xl">
              {targetUser.displayName.charAt(0)}
            </div>
            <div>
              <div className="text-[0.625rem] font-black text-[#c5a059] uppercase tracking-widest mb-1">評分對象</div>
              <h2 className="text-xl font-black text-neutral-900 tracking-tight leading-none">{targetUser.displayName}</h2>
            </div>
          </div>
        </div>

        {/* Game Info Card - Minimal Lux */}
        <div className="bg-white border border-black/[0.04] rounded-lg p-6 shadow-sm">
          <h3 className="text-[0.625rem] font-black text-neutral-400 uppercase tracking-widest mb-5 flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-[#c5a059]"></div>
            團局原始資訊
          </h3>

          <div className="space-y-4">
            <div className="flex items-start gap-4">
              <div className="w-9 h-9 rounded-lg bg-neutral-50 flex items-center justify-center shrink-0">
                <MapPin size="1rem" className="text-neutral-400" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-black text-neutral-900 truncate leading-tight mb-0.5">{game.location.placeName}</div>
                <div className="text-[0.6875rem] font-medium text-neutral-400 line-clamp-1">{game.location.address}</div>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="w-9 h-9 rounded-lg bg-neutral-50 flex items-center justify-center shrink-0">
                <Clock size="1rem" className="text-neutral-400" />
              </div>
              <span className="text-[0.75rem] font-black text-neutral-900 uppercase tracking-widest">
                {new Date(game.gameInfo.startTime).toLocaleString('zh-TW', {
                  month: 'long',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: false
                })}
              </span>
            </div>
          </div>
        </div>

        {/* Rating Section - Minimal Lux */}
        <div className="bg-white border border-black/[0.04] rounded-lg p-6 shadow-sm">
          <h3 className="text-[0.625rem] font-black text-neutral-400 uppercase tracking-widest mb-6 flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-[#c5a059]"></div>
            您的真實評價
          </h3>

          {/* Rating Buttons - Minimal Lux Style */}
          <div className="flex gap-4 mb-8">
            <button
              onClick={() => setIsPositive(true)}
              className={`flex-1 py-5 rounded-lg flex flex-col items-center justify-center gap-2.5 transition-all border ${isPositive === true
                ? 'bg-neutral-900 border-neutral-900 text-[#c5a059] shadow-xl'
                : 'bg-neutral-50 border-black/[0.02] text-neutral-400 hover:bg-white hover:border-[#c5a059]/20'
                }`}
            >
              <ThumbsUp size="1.5rem" strokeWidth={isPositive === true ? 2.5 : 2} />
              <span className="text-[0.6875rem] font-black uppercase tracking-[0.2em]">優秀好評</span>
            </button>
            <button
              onClick={() => setIsPositive(false)}
              className={`flex-1 py-5 rounded-lg flex flex-col items-center justify-center gap-2.5 transition-all border ${isPositive === false
                ? 'bg-neutral-900 border-neutral-900 text-white shadow-xl'
                : 'bg-neutral-50 border-black/[0.02] text-neutral-400 hover:bg-white hover:border-red-100'
                }`}
            >
              <ThumbsDown size="1.5rem" strokeWidth={isPositive === false ? 2.5 : 2} />
              <span className="text-[0.6875rem] font-black uppercase tracking-[0.2em]">待改善</span>
            </button>
          </div>

          {/* Comment Input - Minimal Lux */}
          <div>
            <div className="flex justify-between items-center mb-3 px-1">
              <label className="text-[0.625rem] font-black text-neutral-900 uppercase tracking-widest">具體評價內容</label>
              <span className={`text-[0.5625rem] font-black uppercase tracking-widest ${comment.trim().length >= 5 ? 'text-[#c5a059]' : 'text-neutral-300'}`}>
                {comment.trim().length} / 5
              </span>
            </div>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="您的評價對其他玩家非常重要..."
              className="w-full bg-neutral-50/50 border border-black/[0.03] rounded-lg p-5 text-[0.875rem] font-medium text-neutral-900 placeholder-neutral-300 focus:outline-none focus:bg-white focus:border-[#c5a059]/40 focus:ring-4 focus:ring-[#c5a059]/5 transition-all resize-none min-h-[8.75rem]"
            />
          </div>
        </div>

        {/* Submit Button - Minimal Lux */}
        <button
          onClick={handleSubmit}
          disabled={isPositive === null || comment.trim().length < 5 || submitting}
          className={`w-full py-5 rounded-lg font-black text-[0.75rem] uppercase tracking-[0.3em] transition-all relative overflow-hidden group mb-10 ${isPositive === null || comment.trim().length < 5 || submitting
            ? 'bg-neutral-100 text-neutral-300 cursor-not-allowed'
            : 'bg-neutral-900 text-white shadow-xl active:scale-95'
            }`}
        >
          {submitting ? (
            <div className="flex items-center justify-center gap-2">
              <div className="w-4 h-4 border-2 border-neutral-500 border-t-white rounded-full animate-spin"></div>
              <span>提交中</span>
            </div>
          ) : '確認送出評分'}
        </button>
      </div>


    </div>
  );
};

export default RateUser;

