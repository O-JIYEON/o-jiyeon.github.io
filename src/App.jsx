import { useEffect, useState } from "react";
import MapboxRotatePage from "./pages/MapboxRotatePage";
import NaverGridPage from "./pages/NaverGridPage";

const ROUTES = {
  home: "",
  naver: "naver-grid",
  mapbox: "mapbox",
};

function getRouteFromHash() {
  const rawHash = window.location.hash.replace(/^#/, "").trim();
  return Object.values(ROUTES).includes(rawHash) ? rawHash : ROUTES.home;
}

function navigateTo(route) {
  if (route) {
    window.location.hash = route;
    return;
  }

  const url = new URL(window.location.href);
  url.hash = "";
  window.history.replaceState({}, "", url);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

function HomePage() {
  return (
    <main className="route-home">
      <div className="route-home__panel">
        <p className="eyebrow">ECHOTECH DEMO</p>
        <h1>지도 페이지 선택</h1>
        <p className="route-home__copy">
          기존 네이버 격자 지도와 새 Mapbox 회전 지도를 각각 확인할 수 있습니다.
        </p>

        <div className="route-home__actions">
          <button type="button" onClick={() => navigateTo(ROUTES.naver)}>
            네이버 격자 지도
          </button>
          <button type="button" onClick={() => navigateTo(ROUTES.mapbox)}>
            Mapbox 회전 지도
          </button>
        </div>
      </div>
    </main>
  );
}

export default function App() {
  const [route, setRoute] = useState(() => getRouteFromHash());

  useEffect(() => {
    const handleHashChange = () => setRoute(getRouteFromHash());
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  if (route === ROUTES.naver) {
    return <NaverGridPage onBack={() => navigateTo(ROUTES.home)} />;
  }

  if (route === ROUTES.mapbox) {
    return <MapboxRotatePage onBack={() => navigateTo(ROUTES.home)} />;
  }

  return <HomePage />;
}
