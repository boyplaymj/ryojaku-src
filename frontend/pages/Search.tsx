// pages/Search.tsx — /search 路由殼。內容自 [A2-a-2] 起在 components/SearchContent.tsx，
// 揪咖頁（pages/Matchmaking.tsx）的「找場次」tab 用的是同一份。
// 底部導覽目前仍指著 /search（[A2-b] 才會動它），所以這條路由要繼續能用。
import React from 'react';
import SearchContent from '../components/SearchContent';

const SearchPage: React.FC = () => <SearchContent />;

export default SearchPage;
