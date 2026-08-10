@echo off
cd /d %~dp0
echo BibleNote 서버를 시작합니다.
echo 브라우저에서 http://localhost:8080 을 여세요.
echo (폰에서는 같은 와이파이에서 http://이PC의IP:8080)
echo 종료하려면 이 창을 닫으세요.
python -m http.server 8080
