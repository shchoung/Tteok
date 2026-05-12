
require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// 샘플 빵집 데이터 (DB 연동 전 목 데이터)
const sampleBakeries = [
  {
    id: '1',
    name: '밀도',
    address: '서울 성동구 서울숲2길 32-14',
    lat: 37.5445,
    lng: 127.0374,
    level: 5,
    level_name: '빵신',
    representative_bread: '브리오슈 식빵',
    rating: 4.9,
    review_count: 312,
    level_score: 96.2,
  },
  {
    id: '2',
    name: '몽상클레르',
    address: '서울 서초구 방배중앙로 57',
    lat: 37.4813,
    lng: 126.9966,
    level: 5,
    level_name: '빵신',
    representative_bread: '몽블랑',
    rating: 4.8,
    review_count: 287,
    level_score: 93.5,
  },
  {
    id: '3',
    name: '르빵',
    address: '서울 마포구 와우산로29길 26',
    lat: 37.5538,
    lng: 126.9227,
    level: 4,
    level_name: '빵달인',
    representative_bread: '바게트',
    rating: 4.6,
    review_count: 145,
    level_score: 81.0,
  },
  {
    id: '4',
    name: '브레드림',
    address: '서울 용산구 이태원로 177',
    lat: 37.5347,
    lng: 126.9947,
    level: 4,
    level_name: '빵달인',
    representative_bread: '크루아상',
    rating: 4.5,
    review_count: 98,
    level_score: 78.3,
  },
  {
    id: '5',
    name: '동네빵네',
    address: '서울 강남구 논현로 842',
    lat: 37.5172,
    lng: 127.0391,
    level: 3,
    level_name: '빵고수',
    representative_bread: '소금빵',
    rating: 4.3,
    review_count: 54,
    level_score: 67.1,
  },
  {
    id: '6',
    name: '행복베이커리',
    address: '서울 광진구 능동로 120',
    lat: 37.5484,
    lng: 127.0858,
    level: 2,
    level_name: '빵순이',
    representative_bread: '앙버터',
    rating: 4.1,
    review_count: 23,
    level_score: 52.4,
  },
  {
    id: '7',
    name: '새벽빵집',
    address: '서울 은평구 통일로 684',
    lat: 37.6020,
    lng: 126.9292,
    level: 1,
    level_name: '빵린이',
    representative_bread: '식빵',
    rating: 3.8,
    review_count: 7,
    level_score: 28.5,
  },
];

// API: 전체 빵집 목록
app.get('/api/bakeries', (req, res) => {
  const { level, minScore } = req.query;
  let result = sampleBakeries;
  if (level) result = result.filter(b => b.level === parseInt(level));
  if (minScore) result = result.filter(b => b.level_score >= parseFloat(minScore));
  res.json({ success: true, count: result.length, data: result });
});

// API: 빵집 단건
app.get('/api/bakeries/:id', (req, res) => {
  const bakery = sampleBakeries.find(b => b.id === req.params.id);
  if (!bakery) return res.status(404).json({ success: false, message: '빵집을 찾을 수 없어요' });
  res.json({ success: true, data: bakery });
});

// 헬스체크 (Railway 배포 확인용)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: '빵친자', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`🍞 빵친자 서버 실행 중 → http://localhost:${PORT}`);
});
