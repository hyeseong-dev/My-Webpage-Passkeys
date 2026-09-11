import Home from "./pages/Home";

function NotFound() {
  return (
    <main className="essay not-found">
      <p className="area-label">404</p>
      <h1>이 페이지는 찾을 수 없습니다.</h1>
      <p>공개 소개 페이지에서 다시 시작해 주세요.</p>
      <a className="source-link" href="/">소개 페이지로 돌아가기</a>
    </main>
  );
}

export default function App() {
  return window.location.pathname === "/" ? <Home /> : <NotFound />;
}
