# IDF 팀 웹앱 배포 준비본

처음 시작한다면 **`설치와_운영_매뉴얼.txt`**를 열어 1번부터 따라 하세요. 이 패키지는 IDF v2.3.13 원본을 바탕으로 개인 프로젝트 기본 설정을 제거하고, 팀 Google 인증 및 계정별 API 키 입력을 위해 수정했습니다.

- `src/`: 웹앱 소스. GitHub Actions가 빌드합니다.
- `team-config.js`: 팀의 Firebase 웹 설정과 Gateway 주소만 입력합니다. **개인 API 키나 비밀번호를 넣지 마세요.**
- `worker/src/index.js`: Cloudflare Worker에 배포할 코드.
- `.github/workflows/pages.yml`: main 변경 시 GitHub Pages에 웹앱 자동 빌드·배포.
- `test/`: 팀용 인증·키 분리 테스트.

정적 웹파일과 공개 저장소의 소스는 인터넷에 공개될 수 있습니다. 사내 자료와 비밀정보를 넣지 마세요. 승인되지 않은 계정은 Worker의 보호된 API에 접근할 수 없도록 기본 거부 정책을 사용합니다. 팀원 Gmail은 Cloudflare의 `ALLOWED_EMAILS`에 관리자가 등록해야 합니다.
