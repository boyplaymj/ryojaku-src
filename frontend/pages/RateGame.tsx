import React, { useState, useEffect } from 'react';
import { useToast } from '../contexts/ToastContext';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, ThumbsUp, ThumbsDown, CheckCircle } from 'lucide-react';
import { getGameDetail, getRatings, submitRating } from '../services/apiService';
import { authService } from '../services/authService';

interface Player {
  userId: string;
  displayName: string;
  pictureUrl?: string;
  isHost: boolean;
}

interface Rating {
  isPositive: boolean | null;
  comment: string;
  isSubmitted: boolean;
}

interface GameData {
  gameId: string;
  hostUserId: string;
  hostDisplayName: string;
  location: {
    placeName: string;
  };
  gameInfo: {
    startTime: string;
  };
  joinedPlayers?: Player[];
}

const RateGame: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [game, setGame] = useState<GameData | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [ratings, setRatings] = useState<Record<string, Rating>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const { showToast } = useToast();

  useEffect(() => {
    loadGameData();
  }, [id]);

  const loadGameData = async () => {
    if (!id) return;

    try {
      setLoading(true);
      const currentUser = authService.getCurrentUser();
      if (!currentUser) {
        showToast('請先登入', 'error');
        navigate('/');
        return;
      }

      // Get game detail
      const gameResponse = await getGameDetail(id);
      if (!gameResponse.success || !gameResponse.data?.game) {
        showToast(gameResponse.error || '無法載入團局資訊', 'error');
        navigate(-1);
        return;
      }

      const gameData = gameResponse.data.game;
      setGame(gameData);

      // Check if user is participant
      const isHost = gameData.hostUserId === currentUser.userId;
      const isPlayer = gameData.joinedPlayers?.some((p: Player) => p.userId === currentUser.userId);

      if (!isHost && !isPlayer) {
        showToast('您不是此團局的參與者', 'error');
        navigate(-1);
        return;
      }

      // Get players to rate (exclude current user)
      const playersToRate: Player[] = [];
      const addedUserIds = new Set<string>();

      // Add host if not current user
      if (gameData.hostUserId !== currentUser.userId) {
        playersToRate.push({
          userId: gameData.hostUserId,
          displayName: gameData.hostDisplayName,
          pictureUrl: '',
          isHost: true
        });
        addedUserIds.add(gameData.hostUserId);
      }

      // Add other players
      if (gameData.joinedPlayers) {
        gameData.joinedPlayers.forEach((player: Player) => {
          if (player.userId !== currentUser.userId && !addedUserIds.has(player.userId)) {
            playersToRate.push({
              ...player,
              isHost: false
            });
            addedUserIds.add(player.userId);
          }
        });
      }

      setPlayers(playersToRate);

      // Get existing ratings for this specific game
      const ratingsResponse = await getRatings(currentUser.userId, id);
      const existingRatingsMap: Record<string, any> = {};

      if (ratingsResponse.success && ratingsResponse.data?.ratings) {
        ratingsResponse.data.ratings.forEach((rating: any) => {
          existingRatingsMap[rating.toUserId] = rating;
        });
      }

      // Initialize ratings state
      const initialRatings: Record<string, Rating> = {};
      playersToRate.forEach(player => {
        const existingRating = existingRatingsMap[player.userId];
        if (existingRating) {
          initialRatings[player.userId] = {
            isPositive: existingRating.isPositive,
            comment: existingRating.comment || '',
            isSubmitted: true
          };
        } else {
          initialRatings[player.userId] = {
            isPositive: null,
            comment: '',
            isSubmitted: false
          };
        }
      });
      setRatings(initialRatings);

    } catch (error) {
      console.error('Load game data error:', error);
      showToast('載入失敗,請稍後再試', 'error');
      navigate(-1);
    } finally {
      // Mock Data Injection for Localhost
      if (import.meta.env.DEV) {
        setPlayers(prev => {
          if (prev.length > 0) return prev;

          console.log('Injecting mock players for rating (localhost)');
          const mockPlayers = [
            {
              userId: 'mock-p1',
              displayName: '測試玩家1',
              isHost: false,
              pictureUrl: ''
            },
            {
              userId: 'mock-p2',
              displayName: '測試玩家2',
              isHost: false,
              pictureUrl: ''
            },
            {
              userId: 'mock-host',
              displayName: '測試團主',
              isHost: true,
              pictureUrl: ''
            }
          ];

          // Initialize ratings for mock players
          setRatings(prevRatings => {
            const newRatings = { ...prevRatings };
            mockPlayers.forEach(p => {
              if (!newRatings[p.userId]) {
                newRatings[p.userId] = {
                  isPositive: null,
                  comment: '',
                  isSubmitted: false
                };
              }
            });
            return newRatings;
          });

          return mockPlayers;
        });
      }
      setLoading(false);
    }
  };

  const handleRatingChange = (userId: string, isPositive: boolean) => {
    setRatings(prev => ({
      ...prev,
      [userId]: {
        ...prev[userId],
        isPositive
      }
    }));
  };

  const handleCommentChange = (userId: string, comment: string) => {
    setRatings(prev => ({
      ...prev,
      [userId]: {
        ...prev[userId],
        comment
      }
    }));
  };

  const handleSubmit = async () => {
    const currentUser = authService.getCurrentUser();
    if (!currentUser || !game) return;

    // Filter out already submitted ratings
    const playersToSubmit = players.filter(player => !ratings[player.userId]?.isSubmitted);

    if (playersToSubmit.length === 0) {
      showToast('所有玩家都已經評分過了', 'info');
      return;
    }

    // Validate all unsubmitted players have ratings
    const unratedPlayers = playersToSubmit.filter(player => ratings[player.userId]?.isPositive === null);

    if (unratedPlayers.length > 0) {
      showToast(`請為所有玩家選擇好評或差評（還有 ${unratedPlayers.length} 位未評分）`, 'warning');
      return;
    }

    // Validate comments (must be at least 5 characters)
    const invalidComments = playersToSubmit.filter(player => {
      const comment = ratings[player.userId]?.comment || '';
      return comment.trim().length < 5;
    });

    if (invalidComments.length > 0) {
      showToast('評論內容至少需要 5 個字', 'warning');
      return;
    }

    setSubmitting(true);
    try {
      let successCount = 0;
      const failedRatings: string[] = [];

      for (const player of playersToSubmit) {
        const rating = ratings[player.userId];

        try {
          const response = await submitRating(currentUser.userId, {
            gameId: game.gameId,
            toUserId: player.userId,
            isPositive: rating.isPositive,
            comment: rating.comment.trim()
          });

          if (response.success) {
            successCount++;
          } else {
            failedRatings.push(player.displayName);
            console.error(`Failed to rate ${player.displayName}:`, response.error);
          }
        } catch (error) {
          failedRatings.push(player.displayName);
          console.error(`Error rating ${player.displayName}:`, error);
        }
      }

      if (successCount > 0) {
        showToast(`✅ 成功提交 ${successCount} 則評分！`, 'success');
        setTimeout(() => {
          navigate('/');
        }, 1500);
      }

      if (failedRatings.length > 0) {
        showToast(`評分失敗: ${failedRatings.join(', ')}`, 'error');
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

  if (!game) return null;

  const unsubmittedCount = players.filter(p => !ratings[p.userId]?.isSubmitted).length;
  const canSubmit = unsubmittedCount > 0 && players.every(p => {
    const r = ratings[p.userId];
    return r?.isSubmitted || (r?.isPositive != null && (r?.comment || '').trim().length >= 5);
  });

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
              <span className="text-[0.625rem] font-black text-[#c5a059] uppercase tracking-[0.2em]">GAME FEEDBACK</span>
              <div className="h-[0.0625rem] flex-1 bg-black/[0.03]"></div>
            </div>
            <div className="flex items-center gap-2">
              <p className="text-[0.6875rem] font-black text-neutral-400 bg-neutral-100 px-3 py-1 rounded-full border border-black/[0.02]">
                {game.location.placeName} • 團局評分
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Unsubmitted Badge */}
      {unsubmittedCount > 0 && (
        <div className="px-6 mb-4">
          <div className="bg-[#c5a059]/10 border border-[#c5a059]/20 rounded-lg px-4 py-2 flex items-center justify-between">
            <span className="text-[0.625rem] font-black text-[#c5a059] uppercase tracking-widest">待評分人次</span>
            <span className="text-[0.875rem] font-black text-[#c5a059]">{unsubmittedCount}</span>
          </div>
        </div>
      )}

      {/* Players List */}
      <div className="px-6 space-y-4">
        {players.map((player) => {
          const rating = ratings[player.userId];
          const isSubmitted = rating?.isSubmitted;

          return (
            <div
              key={player.userId}
              className={`bg-white border rounded-lg p-6 shadow-sm transition-all duration-300 relative overflow-hidden ${isSubmitted
                ? 'border-[#c5a059]/20 bg-neutral-50/50'
                : 'border-black/[0.04]'
                }`}
            >
              {/* Submitted State Indicator */}
              {isSubmitted && (
                <div className="absolute top-0 right-0 p-4">
                  <div className="bg-[#c5a059] text-white p-1 rounded-full">
                    <CheckCircle size="0.875rem" />
                  </div>
                </div>
              )}

              {/* Player Info Header */}
              <div className="flex items-center gap-4 mb-6">
                <div className="relative">
                  <div className="w-14 h-14 rounded-lg bg-neutral-900 flex items-center justify-center text-[#c5a059] font-black text-xl shadow-lg overflow-hidden">
                    {player.pictureUrl ? (
                      <img src={player.pictureUrl} alt={player.displayName} className="w-full h-full object-cover" />
                    ) : (
                      <span>{player.displayName.charAt(0)}</span>
                    )}
                  </div>
                  {player.isHost && (
                    <div className="absolute -top-1.5 -left-1.5 bg-[#c5a059] text-white text-[0.5rem] font-black px-2 py-0.5 rounded-lg uppercase tracking-widest shadow-sm border border-white/20">
                      主揪
                    </div>
                  )}
                </div>

                <div className="min-w-0">
                  <h3 className="text-neutral-900 font-black text-lg truncate leading-none mb-1.5">{player.displayName}</h3>
                  <div className="text-[0.5625rem] font-black text-neutral-300 uppercase tracking-widest">PLAYER ID: {player.userId.slice(0, 8)}</div>
                </div>
              </div>

              {isSubmitted ? (
                <div className="bg-white border border-black/[0.03] rounded-lg p-4 relative shadow-sm">
                  <div className="absolute left-0 top-3 bottom-3 w-1 bg-[#c5a059] rounded-full"></div>
                  <p className="text-neutral-600 text-sm font-medium leading-relaxed pl-3 italic">"{rating.comment}"</p>
                  <div className="mt-3 flex justify-end">
                    {rating.isPositive ? (
                      <span className="text-[#c5a059] text-[0.625rem] font-black uppercase tracking-widest flex items-center gap-1.5">
                        <ThumbsUp size="0.75rem" strokeWidth={3} /> 好評已送出
                      </span>
                    ) : (
                      <span className="text-neutral-400 text-[0.625rem] font-black uppercase tracking-widest flex items-center gap-1.5">
                        <ThumbsDown size="0.75rem" strokeWidth={3} /> 負面評價已送出
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Rating Buttons */}
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => handleRatingChange(player.userId, true)}
                      className={`py-4 rounded-lg flex items-center justify-center gap-2.5 transition-all border ${rating?.isPositive === true
                        ? 'bg-neutral-900 border-neutral-900 text-[#c5a059] shadow-xl scale-[1.02]'
                        : 'bg-neutral-50 border-black/[0.02] text-neutral-400 hover:bg-white hover:border-[#c5a059]/20'
                        }`}
                    >
                      <ThumbsUp size="1.125rem" strokeWidth={rating?.isPositive === true ? 3 : 2} />
                      <span className="text-[0.6875rem] font-black uppercase tracking-widest">好評</span>
                    </button>

                    <button
                      onClick={() => handleRatingChange(player.userId, false)}
                      className={`py-4 rounded-lg flex items-center justify-center gap-2.5 transition-all border ${rating?.isPositive === false
                        ? 'bg-neutral-900 border-neutral-900 text-white shadow-xl scale-[1.02]'
                        : 'bg-neutral-50 border-black/[0.02] text-neutral-400 hover:bg-white hover:border-red-100'
                        }`}
                    >
                      <ThumbsDown size="1.125rem" strokeWidth={rating?.isPositive === false ? 3 : 2} />
                      <span className="text-[0.6875rem] font-black uppercase tracking-widest">差評</span>
                    </button>
                  </div>

                  {/* Comment Input */}
                  <div className="relative">
                    <textarea
                      value={rating?.comment || ''}
                      onChange={(e) => handleCommentChange(player.userId, e.target.value)}
                      placeholder="寫下對這位玩家的評價..."
                      className="w-full bg-neutral-100/30 border border-black/[0.03] rounded-lg p-4 text-neutral-900 text-sm font-medium placeholder-neutral-300 focus:outline-none focus:bg-white focus:border-[#c5a059]/30 transition-all resize-none min-h-[6.25rem]"
                      rows={3}
                    />
                    <div className="absolute bottom-3 right-4 text-[0.5625rem] font-black uppercase tracking-widest transition-colors duration-300">
                      <span className={((rating?.comment || '').trim().length || 0) >= 5 ? 'text-[#c5a059]' : 'text-neutral-300'}>
                        {((rating?.comment || '').trim().length || 0)}
                      </span>
                      <span className="text-neutral-200 ml-1">/ 5+</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Submit Button - Fixed at bottom */}
      {unsubmittedCount > 0 && (
        <div className="fixed bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-[#f9f9f7] via-[#f9f9f7] to-transparent z-40">
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
            className={`w-full py-5 rounded-lg font-black text-[0.75rem] uppercase tracking-[0.3em] transition-all shadow-2xl flex items-center justify-center gap-3 active:scale-[0.98] ${!canSubmit || submitting
              ? 'bg-neutral-200 text-neutral-400 cursor-not-allowed shadow-none'
              : 'bg-neutral-900 text-white hover:bg-black'
              }`}
          >
            {submitting ? (
              <div className="w-5 h-5 border-2 border-neutral-400 border-t-white rounded-full animate-spin"></div>
            ) : (
              <CheckCircle size="1.125rem" strokeWidth={2.5} />
            )}
            <span>確認送出 ({unsubmittedCount} 位)</span>
          </button>
        </div>
      )}


    </div>
  );
};

export default RateGame;

