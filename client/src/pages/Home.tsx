import { useEffect, useState, type ReactNode } from "react";
import { ArrowUpRight, ChevronDown, Github, Sparkles } from "lucide-react";
import PasskeyVault from "../components/PasskeyVault";

type StoryCardProps = {
  id: string;
  index: string;
  title: string;
  summary: string;
  children: ReactNode;
  expanded: boolean;
  onToggle: () => void;
};

function StoryCard({ id, index, title, summary, children, expanded, onToggle }: StoryCardProps) {
  return (
    <article className={`story-card ${expanded ? "is-open" : ""}`}>
      <div className="card-topline">
        <span aria-hidden="true">{index}</span>
        <span>가상의 이야기</span>
      </div>
      <h2 className="story-heading">
        <button
          className="story-trigger"
          type="button"
          aria-expanded={expanded}
          aria-controls={`${id}-detail`}
          onClick={onToggle}
        >
          <span>{title}</span>
          <span className="trigger-affordance" aria-hidden="true">
            <span className="trigger-action">{expanded ? "접어두기" : "전문 읽기"}</span>
            <span className="trigger-icon"><ChevronDown size={19} strokeWidth={1.8} /></span>
          </span>
        </button>
      </h2>
      <div className="story-summary"><p>{summary}</p></div>
      <div className="story-detail-wrap" id={`${id}-detail`} aria-hidden={!expanded}>
        <div className="story-detail">{children}</div>
      </div>
    </article>
  );
}

export default function Home() {
  const [openCard, setOpenCard] = useState<string | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const sourceUrl = import.meta.env.VITE_SOURCE_URL || "https://github.com/hyeseong-dev/My-Webpage-Passkeys";

  useEffect(() => {
    document.documentElement.classList.toggle("user-reduce-motion", reduceMotion);
    return () => document.documentElement.classList.remove("user-reduce-motion");
  }, [reduceMotion]);

  const toggleCard = (cardId: string) => setOpenCard(current => current === cardId ? null : cardId);

  return (
    <div className={`site-shell ${reduceMotion ? "reduce-motion" : ""}`}>
      <a className="skip-link" href="#public-introduction">본문으로 바로 가기</a>
      <main className="essay">
        <header className="intro-header" id="public-introduction">
          <div className="intro-orbit" aria-hidden="true">
            <span className="orbit-orange" /><span className="orbit-sage" /><span className="orbit-dot" />
          </div>
          <p className="area-label">PUBLIC STORY · 누구나 읽는 소개</p>
          <h1>
            작은 호기심을 기록하고, 사람들과 함께 답을 찾아가는 <em>여울</em>입니다.
            <span className="hero-values">천천히 살피고, 직접 해보고, 배운 것을 나눕니다.</span>
          </h1>
          <p className="intro-caption">배움과 협업, 기록을 좋아하는 가상 인물의 소개 페이지입니다. 세 가지 이야기에서 일상을 대하는 태도를 만나보세요.</p>
          <p className="synthetic-notice">교육용 데모입니다. ‘여울’과 아래 소개·경험·비공개 자료는 모두 만들어 넣은 예시이며, 실제 개인의 이력이나 개인정보가 아닙니다.</p>
          <nav className="evidence-rail" aria-label="페이지 탐색">
            <a href="#public-stories">세 가지 이야기</a>
            <a href="#learning-traces">배움의 흔적</a>
            <a href="#private-space">패스키로 여는 비공개 영역</a>
          </nav>
        </header>

        <section className="story-list" id="public-stories" aria-label="나를 소개하는 세 가지 가상 이야기">
          <StoryCard
            id="story-one"
            index="01"
            title="작게 시작해서 함께 확인한다"
            summary="처음부터 완벽한 답을 찾기보다, 지금 할 수 있는 작은 시도를 통해 다음 방향을 정합니다."
            expanded={openCard === "story-one"}
            onToggle={() => toggleCard("story-one")}
          >
            <div className="story-points">
              <p><strong>상황</strong><span>가상의 독서 모임에서 읽고 싶은 책과 모일 날짜를 정하는 데 대화가 길어졌습니다. 의견은 많았지만, 결정한 내용을 다시 찾기 어려웠습니다.</span></p>
              <p><strong>행동</strong><span>모임 구성원들과 필요한 항목 세 가지를 정하고, 작은 안내 화면을 만들었습니다. 먼저 한 번 사용해 본 뒤 표현이 헷갈리는 부분을 함께 고쳤습니다.</span></p>
              <p><strong>배움</strong><span>작은 결과라도 함께 확인할 수 있으면 대화가 구체적으로 바뀐다는 점을 배웠습니다. 다음 시도에서도 먼저 보여주고 의견을 듣는 습관을 이어가려 합니다.</span></p>
            </div>
          </StoryCard>

          <StoryCard
            id="story-two"
            index="02"
            title="모르는 것을 질문으로 남긴다"
            summary="낯선 내용을 만나면 서둘러 아는 척하지 않고, 이해한 부분과 아직 궁금한 부분을 나누어 적습니다."
            expanded={openCard === "story-two"}
            onToggle={() => toggleCard("story-two")}
          >
            <div className="story-points">
              <p><strong>상황</strong><span>가상의 학습 모임에서 처음 접하는 개념을 설명해야 했습니다. 자료를 읽었지만 다른 사람에게 쉽게 설명하기는 어려웠습니다.</span></p>
              <p><strong>행동</strong><span>직접 설명할 수 있는 내용은 짧게 적고, 막히는 부분은 질문으로 남겼습니다. 모임에서는 질문 하나를 골라 예시를 만들고 서로의 설명을 비교했습니다.</span></p>
              <p><strong>배움</strong><span>정리되지 않은 질문도 배움을 시작하는 데 도움이 되었습니다. 기록의 빈칸을 숨기기보다 다음에 확인할 지점으로 남기게 되었습니다.</span></p>
            </div>
          </StoryCard>

          <StoryCard
            id="story-three"
            index="03"
            title="다음 사람을 위해 한 번 더 살핀다"
            summary="내게 익숙한 일도 처음 만나는 사람에게는 낯설 수 있습니다. 설명을 읽는 사람의 입장에서 한 번 더 확인합니다."
            expanded={openCard === "story-three"}
            onToggle={() => toggleCard("story-three")}
          >
            <div className="story-points">
              <p><strong>상황</strong><span>가상의 만들기 모임에 새 구성원이 들어왔습니다. 기존 안내문에는 오래 참여한 사람만 이해할 수 있는 줄임말이 많았습니다.</span></p>
              <p><strong>행동</strong><span>새 구성원에게 안내문을 읽으며 궁금한 점을 표시해 달라고 부탁했습니다. 준비물과 순서를 풀어 쓰고, 처음 시작하는 위치를 앞부분에 덧붙였습니다.</span></p>
              <p><strong>배움</strong><span>잘 설명했다고 생각한 문장에도 누군가의 질문이 필요하다는 점을 알게 되었습니다. 일을 마무리할 때 다음 사람이 이어가기 쉬운지도 살펴봅니다.</span></p>
            </div>
            <p className="story-closing">작은 배려는 다음 사람이 편하게 시작할 수 있는 여백을 남기는 일이라고 생각합니다.</p>
          </StoryCard>
        </section>

        <section className="experience-section" id="learning-traces" aria-labelledby="experience-heading">
          <div className="section-heading">
            <p>SELECTED TRACE · 가상의 학습 기록</p>
            <h2 id="experience-heading">배움을 이어가는 두 가지 습관</h2>
          </div>
          <div className="experience-grid">
            <article className="experience-card">
              <p className="experience-index">직접 해보기</p>
              <h3>궁금한 것은 작은 실험으로 확인합니다.</h3>
              <p>읽은 내용을 그대로 외우기보다 조건을 하나씩 바꿔 봅니다. 예상과 다른 결과가 나오면 그 차이를 다음 질문으로 삼습니다.</p>
            </article>
            <article className="experience-card experience-card-sage">
              <p className="experience-index">다시 꺼내보기</p>
              <h3>기록에는 결과와 질문을 함께 남깁니다.</h3>
              <p>무엇을 했는지, 어디에서 막혔는지, 다음에 무엇을 확인할지 적습니다. 완성된 글뿐 아니라 미완성인 생각에도 자리를 줍니다.</p>
            </article>
          </div>
        </section>

        <aside className="evidence-note" aria-label="가상 인물이 연습하는 습관">
          <div className="note-mark" aria-hidden="true"><Sparkles size={17} /></div>
          <div>
            <h2>요즘 연습하는 습관</h2>
            <p>궁금한 것을 모두 한 번에 해결하려 하면 시작이 늦어집니다. 오늘 확인할 질문 하나를 정하고, 작은 진전도 기록하는 연습을 합니다.</p>
          </div>
        </aside>

        <div id="private-space" className="private-space-anchor">
          <PasskeyVault />
        </div>
      </main>

      <footer className="site-footer">
        <div className="footer-inner">
          <a className="source-link" href={sourceUrl} target="_blank" rel="noreferrer">
            <Github size={16} aria-hidden="true" />공개 소스<ArrowUpRight size={14} aria-hidden="true" />
          </a>
          <span className="source-note">가상 인물과 합성 자료로 구성한 교육용 데모</span>
          <button
            className="motion-toggle"
            type="button"
            role="switch"
            aria-checked={reduceMotion}
            onClick={() => setReduceMotion(current => !current)}
          >
            <span className="toggle-visual" aria-hidden="true"><span /></span>모션 줄이기
          </button>
        </div>
      </footer>
    </div>
  );
}
