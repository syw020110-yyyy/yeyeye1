// 나비 (NABI) - Leaflet 기반 인터랙티브 혼잡도 지도 및 골목 렌더러

import { getCongestionMeta } from './congestionEngine.js?v=20260915_10';

export class MapManager {
  constructor(mapContainerId, onSpotSelect) {
    this.containerId = mapContainerId;
    this.onSpotSelect = onSpotSelect;
    this.map = null;
    this.markersLayer = null;
    this.alleysLayer = null;
    this.routeLayer = null;
    this.userMarker = null;
    this.spotMarkerMap = new Map();
  }

  init(initialCenter = [37.5800, 126.9770], initialZoom = 15) {
    if (this.map) return;

    // Leaflet 맵 인스턴스 생성
    this.map = L.map(this.containerId, {
      center: initialCenter,
      zoom: initialZoom,
      zoomControl: false,
      attributionControl: false
    });

    // 워터마크 없는 고해상도 벡터 Positron 베이스맵 (Carto Positron 디자인 완벽 구현)
    try {
      if (typeof L.maplibreGL === 'function') {
        L.maplibreGL({
          style: 'https://tiles.openfreemap.org/styles/positron',
          attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
        }).addTo(this.map);
      } else {
        throw new Error('MapLibre GL Leaflet plugin is not loaded');
      }
    } catch (err) {
      console.warn('MapLibre GL init error, falling back to tile layer:', err);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(this.map);
    }

    // 줌 컨트롤러 우측 상단 배치
    L.control.zoom({ position: 'topright' }).addTo(this.map);

    // 레이어 그룹 초기화
    this.alleysLayer = L.layerGroup().addTo(this.map);
    this.markersLayer = L.layerGroup().addTo(this.map);
    this.reportedLayer = L.layerGroup().addTo(this.map);
    this.routeLayer = L.layerGroup().addTo(this.map);
  }

  /**
   * 골목 네트워크 혼잡도 폴리라인 렌더링
   */
  renderAlleys(alleys) {
    this.alleysLayer.clearLayers();

    alleys.forEach(alley => {
      let color = '#059669'; // smooth (여유 - 선명한 에메랄드)
      let glowColor = '#10B981';
      let weight = 7;
      let glowWeight = 16;
      let opacity = 0.95;
      let glowOpacity = 0.35;
      let dashArray = null;

      if (alley.congestionLevel === 'crowded') {
        color = '#FF2D55'; // 혼잡 - 눈에 띄는 네온 코랄 레드
        glowColor = '#FF2D55';
        weight = 8.5;
        glowWeight = 20;
        glowOpacity = 0.45;
      } else if (alley.congestionLevel === 'moderate') {
        color = '#F59E0B'; // 보통 - 선명한 앰버 옐로우
        glowColor = '#FBBF24';
        weight = 7.5;
        glowWeight = 17;
        glowOpacity = 0.38;
      } else {
        // Breeze Route (한적한 골목) 강조
        color = '#059669';
        glowColor = '#10B981';
        weight = 7;
        glowWeight = 16;
        glowOpacity = 0.35;
      }

      // 1. 글로우/언더 레이어 (시각적 깊이감 & 혼잡도 강조)
      const glowLine = L.polyline(alley.coordinates, {
        color: glowColor,
        weight: glowWeight,
        opacity: glowOpacity,
        lineCap: 'round',
        lineJoin: 'round'
      });
      this.alleysLayer.addLayer(glowLine);

      // 2. 메인 폴리라인
      const mainLine = L.polyline(alley.coordinates, {
        color: color,
        weight: weight,
        opacity: opacity,
        lineCap: 'round',
        lineJoin: 'round',
        dashArray: dashArray
      });

      // 툴팁 바인딩
      const statusEmoji = alley.congestionLevel === 'smooth' ? '🟢 여유' : (alley.congestionLevel === 'moderate' ? '🟡 보통' : '🔴 혼잡');
      mainLine.bindTooltip(`
        <div class="alley-tooltip">
          <strong>${alley.name}</strong>
          <span class="alley-badge badge-${alley.congestionLevel}">${statusEmoji}</span>
          <p class="alley-desc">${alley.description}</p>
        </div>
      `, {
        sticky: true,
        direction: 'top',
        className: 'custom-leaflet-tooltip'
      });

      this.alleysLayer.addLayer(mainLine);
    });
  }

  /**
   * 로컬 스팟 커스텀 마커 렌더링
   */
  renderSpots(spots, activeCategory = 'all', activeSpotId = null) {
    this.markersLayer.clearLayers();
    this.spotMarkerMap.clear();

    const filteredSpots = activeCategory === 'all'
      ? spots
      : spots.filter(s => s.category === activeCategory);

    filteredSpots.forEach(spot => {
      const score = spot.currentCongestionScore || spot.baseCongestionScore;
      const meta = getCongestionMeta(score);
      const isSelected = activeSpotId === spot.id;

      // 커스텀 HTML 아이콘 생성
      const iconHtml = `
        <div class="custom-spot-marker ${meta.level} ${isSelected ? 'selected' : ''}" data-spot-id="${spot.id}">
          <div class="marker-pulse" style="background-color: ${meta.color}33;"></div>
          <div class="marker-pin" style="border-color: ${meta.color};">
            <span class="marker-dot" style="background-color: ${meta.color};"></span>
            <span class="marker-name">${spot.name}</span>
          </div>
        </div>
      `;

      const customIcon = L.divIcon({
        html: iconHtml,
        className: 'leaflet-custom-marker-container',
        iconSize: [120, 42],
        iconAnchor: [60, 36]
      });

      const marker = L.marker(spot.coords, { icon: customIcon });
      
      marker.on('click', () => {
        if (this.onSpotSelect) {
          this.onSpotSelect(spot);
        }
      });

      this.markersLayer.addLayer(marker);
      this.spotMarkerMap.set(spot.id, marker);
    });
  }

  /**
   * 현장 제보 장소 마커 및 투표 팝업 렌더링
   * @param {Array} reportedPlaces 
   * @param {string} activeRegion 
   * @param {Function} onVoteClick 
   * @param {Function} hasUserVotedFn 
   */
  renderReportedPlaces(reportedPlaces = [], activeRegion = 'all', onVoteClick, hasUserVotedFn) {
    this.reportedLayer.clearLayers();

    const filtered = activeRegion === 'all'
      ? reportedPlaces
      : reportedPlaces.filter(p => {
          if (activeRegion === 'seochon') return p.area === '서촌';
          if (activeRegion === 'anguk') return p.area === '안국·북촌';
          return true;
        });

    filtered.forEach(place => {
      const isPending = (place.votes || 0) < 3;
      const hasVoted = hasUserVotedFn ? hasUserVotedFn(place.id) : false;

      // 커스텀 HTML 아이콘
      // 1) 검토 중(isPending): 점선 회색 핀 + ⏳ + 투표수 뱃지(1/3, 2/3)
      // 2) 정식 등록(verified): 기존 스팟과 동일한 그린 도트 핀 + 인원수/이모지 제거!
      const iconHtml = isPending ? `
        <div class="custom-reported-marker pending" data-place-id="${place.id}">
          <div class="reported-pulse"></div>
          <div class="reported-pin">
            <span class="reported-status-icon">⏳</span>
            <span class="reported-name">${place.name}</span>
            <span class="reported-vote-badge">${place.votes}/3</span>
          </div>
        </div>
      ` : `
        <div class="custom-spot-marker smooth verified-pin-marker" data-place-id="${place.id}">
          <div class="marker-pulse" style="background-color: rgba(5, 150, 105, 0.2);"></div>
          <div class="marker-pin" style="border-color: #059669;">
            <span class="marker-dot" style="background-color: #059669;"></span>
            <span class="marker-name">${place.name}</span>
          </div>
        </div>
      `;

      const customIcon = L.divIcon({
        html: iconHtml,
        className: isPending ? 'leaflet-reported-marker-container' : 'leaflet-custom-marker-container',
        iconSize: isPending ? [130, 42] : [120, 42],
        iconAnchor: isPending ? [65, 36] : [60, 36]
      });

      const marker = L.marker([place.lat, place.lng], { icon: customIcon });

      // 방문객 추천 투표 인터랙티브 팝업
      const popupHtml = `
        <div class="reported-popup-card">
          <div class="reported-popup-header">
            <span class="reported-area-tag">📍 ${place.area}</span>
            <span class="reported-status-pill ${isPending ? 'pending' : 'verified'}">
              ${isPending ? '⏳ 현장 검토 중' : '✨ 정식 추천지 인증'}
            </span>
          </div>
          <h4 class="reported-popup-title">${place.name}</h4>
          ${place.address ? `
            <div class="reported-popup-address-row">
              <span class="addr-text">📍 ${place.address}</span>
              <a href="${place.address.startsWith('http') ? place.address : `https://map.naver.com/v5/search/${encodeURIComponent(place.address || place.name)}`}" target="_blank" class="reported-naver-link">
                네이버 지도 ↗
              </a>
            </div>
          ` : ''}
          
          <div class="reported-gauge-box">
            <div class="gauge-header">
              <span>방문객 추천 투표</span>
              <span class="gauge-count"><strong>${place.votes}</strong> / 3명</span>
            </div>
            <div class="gauge-track">
              <div class="gauge-fill ${isPending ? 'pending' : 'verified'}" style="width: ${Math.min(100, ((place.votes || 1) / 3) * 100)}%;"></div>
            </div>
            <p class="gauge-guide">
              ${isPending ? '💡 3명이 추천하면 [초록색 정식 핀]으로 자동 전환됩니다.' : '🎉 3명 이상의 현장 추천을 받아 인증된 공간입니다.'}
            </p>
          </div>

          <div class="reported-popup-actions">
            ${hasVoted ? `
              <button class="btn-vote-submit voted" disabled>
                ✅ 이미 추천 투표 완료 (${place.votes}표)
              </button>
            ` : `
              <button class="btn-vote-submit" data-place-id="${place.id}">
                👍 저도 여기 추천해요! (+1표)
              </button>
            `}
          </div>
        </div>
      `;

      marker.bindPopup(popupHtml, {
        className: 'reported-custom-popup',
        maxWidth: 280,
        minWidth: 260
      });

      marker.on('popupopen', (e) => {
        const popupNode = e.popup.getElement();
        if (!popupNode) return;
        const voteBtn = popupNode.querySelector('.btn-vote-submit:not(.voted)');
        if (voteBtn) {
          voteBtn.addEventListener('click', () => {
            if (onVoteClick) {
              onVoteClick(place.id);
            }
          });
        }
      });

      this.reportedLayer.addLayer(marker);
    });
  }

  /**
   * 사용자 위치 핀 업데이트
   */
  updateUserLocation(coords, name = '현재 위치') {
    if (this.userMarker) {
      this.userMarker.setLatLng(coords);
      this.userMarker.setTooltipContent(`<div class="user-gps-tooltip">📍 ${name}</div>`);
    } else {
      const userIcon = L.divIcon({
        html: `
          <div class="user-gps-marker">
            <div class="gps-pulse"></div>
            <div class="gps-core"></div>
          </div>
        `,
        className: 'leaflet-user-marker',
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      });

      this.userMarker = L.marker(coords, { icon: userIcon, zIndexOffset: 1000 }).addTo(this.map);
      this.userMarker.bindTooltip(`<div class="user-gps-tooltip">📍 ${name}</div>`, {
        permanent: false,
        direction: 'top'
      });
    }
  }

  /**
   * 만석 스팟 -> 대체 공간 간의 도보 우회 경로 (Dashed Line) 시각화
   */
  drawAlternativeRoute(originCoords, destCoords, originName, destName) {
    this.routeLayer.clearLayers();

    if (!originCoords || !destCoords) return;

    // 경로 라인 그리기
    const pathCoords = [originCoords, destCoords];

    // 글로우 언더레이
    const routeGlow = L.polyline(pathCoords, {
      color: '#10B981',
      weight: 8,
      opacity: 0.35,
      lineCap: 'round'
    });
    this.routeLayer.addLayer(routeGlow);

    // 애니메이션 점선
    const routeLine = L.polyline(pathCoords, {
      color: '#10B981',
      weight: 4,
      dashArray: '8, 8',
      className: 'animated-walking-route',
      lineCap: 'round'
    });
    this.routeLayer.addLayer(routeLine);

    // 지도 뷰포트를 두 지점이 모두 보이도록 맞춤
    const bounds = L.latLngBounds(pathCoords);
    this.map.fitBounds(bounds, { padding: [80, 80], maxZoom: 17, animate: true });
  }

  clearRoute() {
    this.routeLayer.clearLayers();
  }

  flyToLocation(coords, zoom = 16) {
    if (this.map) {
      this.map.flyTo(coords, zoom, {
        duration: 0.8,
        easeLinearity: 0.25
      });
    }
  }

  highlightMarker(spotId) {
    // DOM 업데이트
    document.querySelectorAll('.custom-spot-marker').forEach(el => {
      if (el.dataset.spotId === spotId) {
        el.classList.add('selected');
      } else {
        el.classList.remove('selected');
      }
    });
  }
}
