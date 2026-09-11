import { useEffect, useState, type ReactNode } from "react";
import { ArrowUpRight, ChevronDown, Github, Sparkles } from "lucide-react";
import PasskeyVault from "../components/PasskeyVault";

type StoryCardProps = {
  id: string;
  index: string;
  title: string;
  summary: ReactNode;
  children: ReactNode;
  expanded: boolean;
  onToggle: () => void;
};

function StoryCard({
  id,
  index,
  title,
  summary,
  children,
  expanded,
  onToggle,
}: StoryCardProps) {
  return (
    <article className={`story-card ${expanded ? "is-open" : ""}`}>
      <div className="card-topline">
        <span aria-hidden="true">{index}</span>
        <span>강점</span>
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
            <span className="trigger-action">
              {expanded ? "접어두기" : "전문 읽기"}
            </span>
            <span className="trigger-icon">
              <ChevronDown size={19} strokeWidth={1.8} />
            </span>
          </span>
          <span className="sr-only">
            {expanded ? "전문 접기" : "전문 읽기"}
          </span>
        </button>
      </h2>
      <div className="story-summary">{summary}</div>
      <div
        className="story-detail-wrap"
        id={`${id}-detail`}
        aria-hidden={!expanded}
      >
        <div className="story-detail">{children}</div>
      </div>
    </article>
  );
}

export default function Home() {
  const [openCard, setOpenCard] = useState<string | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const sourceUrl =
    import.meta.env.VITE_SOURCE_URL ||
    "https://github.com/hyeseong-dev/My-Webpage-Passkeys";

  useEffect(() => {
    document.documentElement.classList.toggle(
      "user-reduce-motion",
      reduceMotion,
    );
    return () =>
      document.documentElement.classList.remove("user-reduce-motion");
  }, [reduceMotion]);

  const toggleCard = (cardId: string) =>
    setOpenCard((current) => (current === cardId ? null : cardId));

  return (
    <div className={`site-shell ${reduceMotion ? "reduce-motion" : ""}`}>
      <a className="skip-link" href="#public-introduction">
        본문으로 바로 가기
      </a>
      <main className="essay">
        <header className="intro-header" id="public-introduction">
          <div className="intro-orbit" aria-hidden="true">
            <span className="orbit-orange" />
            <span className="orbit-sage" />
            <span className="orbit-dot" />
          </div>
          <p className="area-label">PUBLIC STORY · 누구나 읽는 소개</p>
          <h1>
            사람 곁에서 삶을 회복하고, 배움으로 다시 길을 만들어가는{" "}
            <em>이혜성</em>입니다.
            <span className="hero-values">
              작은 일에도 정성을 다하며, 제약 속에서도 함께 끝까지 작동하는 답을
              찾습니다.
            </span>
          </h1>
          <p className="intro-caption">
            네트워크·보안 분야에서 함께 배우고 일할 동료에게, 삶의 선택과 문제
            해결, 기록하는 습관으로 만들어온 저의 기준을 소개합니다.
          </p>
          <p className="synthetic-notice">
            공개 소개는 작성자가 공개 범위를 선별한 실제 자기소개입니다. 패스키
            영역의 계정과 비공개 기록은 인증 기능 검증을 위해 만든 합성
            데이터입니다.
          </p>
          <nav
            className="evidence-rail"
            aria-label="페이지 탐색 및 기록의 흔적"
          >
            <a href="#public-stories">세 가지 이야기</a>
            <a href="#learning-traces">배움의 흔적</a>
            <a href="#private-space">패스키로 여는 비공개 영역</a>
            <a
              href="https://thoughtful-shovel-8c4.notion.site/3cd51ce0d12780aab7eddc6806aab547"
              target="_blank"
              rel="noreferrer"
            >
              Notion 학습 그래프
            </a>
            <a
              href="https://hyeseong-dev.tistory.com/"
              target="_blank"
              rel="noreferrer"
            >
              Tistory 기술 기록
            </a>
            <a
              href="https://velog.io/@hyeseong-dev/"
              target="_blank"
              rel="noreferrer"
            >
              Velog 개발 기록
            </a>
          </nav>
        </header>

        <section
          className="story-list"
          id="public-stories"
          aria-label="나를 소개하는 세 가지 이야기"
        >
          <StoryCard
            id="story-one"
            index="01"
            title="제약 속에서도 작동하는 답을 찾는다"
            expanded={openCard === "story-one"}
            onToggle={() => toggleCard("story-one")}
            summary={
              <p>
                이상적인 기술만 기다리기보다, 사람과 시간, 운영 환경 안에서 지금
                팀이 구현하고 검증할 수 있는 길을 찾는다.
              </p>
            }
          >
            <div className="story-points">
              <p>
                <strong>상황</strong>
                <span>
                  의료기기 박람회 시연을 앞두고, 음성 AI의 요청과 응답을 웹
                  화면에 보여주는 기능을 신입 개발자 중심의 팀에서 만들어야
                  했다.
                </span>
              </p>
              <p>
                <strong>행동</strong>
                <span>
                  응답 시점을 예측할 수 있어 양방향 연결이 이상적이었지만,
                  바닐라 JavaScript 환경과 촉박한 일정, 팀의 구현 여건을 함께
                  살폈다. polling으로 먼저 동작을 확인한 뒤, 반복 조회와 중복
                  요청이 커지는 문제를 발견해 long-polling 방식으로 요청 흐름을
                  정리했다.
                </span>
              </p>
              <p>
                <strong>결과</strong>
                <span>
                  전시 일정 안에 팀이 이해하고 검증할 수 있는 방식으로 기능을
                  완성했다. 좋은 기술을 고르는 일은 최신 방식을 고집하는 것이
                  아니라, 현실의 제약까지 보고 끝까지 작동할 답을 만드는 일임을
                  배웠다.
                </span>
              </p>
            </div>
          </StoryCard>

          <StoryCard
            id="story-two"
            index="02"
            title="가까운 사람 곁에서 다시 배우기를 선택했다"
            expanded={openCard === "story-two"}
            onToggle={() => toggleCard("story-two")}
            summary={
              <p>
                서울에서 개발자로 일하며 지쳐가던 때, 사랑하는 사람들과 더
                가까이 살아가기로 했다. 그 선택은 멈춤이 아니라 새로운 배움의
                시작이었다.{" "}
                <a
                  href="https://thoughtful-shovel-8c4.notion.site/3cd51ce0d12780aab7eddc6806aab547"
                  className="evidence-link"
                  target="_blank"
                  rel="noreferrer"
                >
                  <span>지금의 배움</span> Notion 학습 그래프{" "}
                  <ArrowUpRight size={14} aria-hidden="true" />
                </a>
              </p>
            }
          >
            <div className="story-points">
              <p>
                <strong>상황</strong>
                <span>
                  서울에서 홀로 생활하며 몸과 마음이 지치고, 불확실한 미래와
                  비교 속에서 스스로를 소진시키는 질문이 이어졌다.
                </span>
              </p>
              <p>
                <strong>행동</strong>
                <span>
                  대구·경북의 고향으로 내려와 소중한 사람들과 더 자주 이야기하고
                  함께 밥을 먹을 수 있는 삶을 선택했다. 커리어를 이어가면서도
                  좋아하는 배움을 지속할 길을 찾다가 SKT-ALEPH 과정에서
                  네트워크와 보안을 배우기 시작했다.
                </span>
              </p>
              <p>
                <strong>결과</strong>
                <span>
                  삶의 중심을 회복한 자리에서 개발 경험을 네트워크·보안까지
                  넓혀가고 있다. 불확실성 앞에서 자신을 몰아붙이기보다, 사람
                  곁에서 다시 배우는 선택을 기준으로 삼게 됐다.
                </span>
              </p>
            </div>
          </StoryCard>

          <StoryCard
            id="story-three"
            index="03"
            title="작은 일에도 정성을 다한다"
            expanded={openCard === "story-three"}
            onToggle={() => toggleCard("story-three")}
            summary={
              <p>
                낯선 환경을 지날 때마다 먼저 듣고, 작은 일도 가볍게 넘기지
                않으며, 다른 사람이 다음에 이해할 수 있도록 남긴다.{" "}
                <a
                  href="https://hyeseong-dev.tistory.com/"
                  className="evidence-link"
                  target="_blank"
                  rel="noreferrer"
                >
                  <span>배움의 기록</span> Tistory{" "}
                  <ArrowUpRight size={14} aria-hidden="true" />
                </a>
              </p>
            }
          >
            <div className="story-points">
              <p>
                <strong>상황</strong>
                <span>
                  필리핀의 연수와 봉사활동, 미국 인턴, 베트남 현지 근무를 거치며
                  서로 다른 언어와 문화를 가진 사람들과 생활하고 일했다.
                </span>
              </p>
              <p>
                <strong>행동</strong>
                <span>
                  내 방식부터 내세우기보다 상대의 이야기를 먼저 듣고, 이해가
                  엇갈리는 부분은 누구나 다시 확인할 수 있도록 정리했다. 배운
                  내용도 혼자 소비하지 않고 Notion·Tistory·Velog에 기록해 다음
                  질문과 연결했다.
                </span>
              </p>
              <p>
                <strong>결과</strong>
                <span>
                  개발자가 된 뒤에도 문서와 데이터 구조로 서로 다른 요구를 함께
                  이해할 수 있게 돕는 태도를 이어가고 있다. 작은 일에도 정성을
                  다하는 모습이 밖으로 드러나 사람과 일을 조금씩 변화시킨다고
                  믿는다.
                </span>
              </p>
            </div>
            <p className="story-closing">
              저에게 정성은 거창한 선언이 아니라, 작은 일도 놓치지 않고 다음
              사람을 위해 한 번 더 살피는 태도입니다.
            </p>
          </StoryCard>
        </section>

        <section
          className="experience-section"
          id="learning-traces"
          aria-labelledby="experience-heading"
        >
          <div className="section-heading">
            <p>SELECTED TRACE</p>
            <h2 id="experience-heading">내가 남기는 두 가지 흔적</h2>
          </div>
          <div className="experience-grid">
            <article className="experience-card">
              <p className="experience-index">일의 흐름</p>
              <h3>기술의 선택에는 사람과 시간이 함께 있습니다.</h3>
              <p>
                복잡한 시스템을 만날 때 이상적인 해법과 지금 실행할 수 있는 해법
                사이를 살피고, 팀이 같은 방향을 볼 수 있도록 요청 흐름과 문서를
                정리합니다.
              </p>
            </article>
            <article className="experience-card experience-card-sage">
              <p className="experience-index">배움의 기록</p>
              <h3>배운 내용은 다음 문제를 위한 언어로 남깁니다.</h3>
              <p>
                Notion에는 개념·실습·질문·검증을 연결하고, Tistory와 Velog에는
                배운 과정과 개발 경험을 글로 남기며 다음 학습으로 이어갑니다.
              </p>
              <div className="experience-links">
                <a
                  href="https://thoughtful-shovel-8c4.notion.site/3cd51ce0d12780aab7eddc6806aab547"
                  target="_blank"
                  rel="noreferrer"
                >
                  Notion <ArrowUpRight size={14} aria-hidden="true" />
                </a>
                <a
                  href="https://hyeseong-dev.tistory.com/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Tistory <ArrowUpRight size={14} aria-hidden="true" />
                </a>
                <a
                  href="https://velog.io/@hyeseong-dev/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Velog <ArrowUpRight size={14} aria-hidden="true" />
                </a>
              </div>
            </article>
          </div>
        </section>

        <aside className="evidence-note" aria-label="요즘 고치는 습관">
          <div className="note-mark" aria-hidden="true">
            <Sparkles size={17} />
          </div>
          <div>
            <h2>요즘 고치는 습관</h2>
            <p>
              좋은 방법을 찾느라 목적보다 수단에 오래 머무를 때가 있습니다.
              그래서 먼저 우선순위를 정하고, 탐구할 시간에 한도를 두며,
              주기적으로 지금의 선택이 목표에 가까워지는지 확인합니다.
            </p>
          </div>
        </aside>

        <div id="private-space" className="private-space-anchor">
          <PasskeyVault />
        </div>
      </main>

      <footer className="site-footer">
        <div className="footer-inner">
          <a
            className="source-link"
            href={sourceUrl}
            target="_blank"
            rel="noreferrer"
          >
            <Github size={16} aria-hidden="true" />
            공개 소스
            <ArrowUpRight size={14} aria-hidden="true" />
          </a>
          <span className="source-note">
            공개 자기소개와 합성 인증 자료를 분리한 교육용 데모
          </span>
          <button
            className="motion-toggle"
            type="button"
            role="switch"
            aria-checked={reduceMotion}
            onClick={() => setReduceMotion((current) => !current)}
          >
            <span className="toggle-visual" aria-hidden="true">
              <span />
            </span>
            모션 줄이기
          </button>
        </div>
      </footer>
    </div>
  );
}
