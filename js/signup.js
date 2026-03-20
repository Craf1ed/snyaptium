window.switchTab = function(tab) {
  const tabs = document.querySelectorAll('.auth-tab');
  const forms = document.querySelectorAll('.form-container');
  tabs.forEach(t => t.classList.remove('active'));
  forms.forEach(f => f.classList.remove('active'));
  
  if (tab === 'login') {
    tabs[0].classList.add('active');
    document.getElementById('loginForm').classList.add('active');
  } else {
    tabs[1].classList.add('active');
    document.getElementById('signupForm').classList.add('active');
  }
  hideError();
}

function showError(message) {
  const errorDiv = document.getElementById('errorMessage');
  errorDiv.textContent = message;
  errorDiv.classList.add('show');
}

function hideError() {
  document.getElementById('errorMessage').classList.remove('show');
}

window.openModal = function(type) {
  const modalId = type === 'terms' ? 'termsModal' : 'privacyModal';
  document.getElementById(modalId).classList.add('active');
}

window.closeModal = function(type) {
  const modalId = type === 'terms' ? 'termsModal' : 'privacyModal';
  document.getElementById(modalId).classList.remove('active');
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.model-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.classList.remove('active');
      }
    });
  });
});

function createGridLines() {
  const spacing = 100;
  
  for(let i = 0; i < window.innerWidth; i += spacing) {
    const line = document.createElement('div');
    line.className = 'grid-line vertical';
    line.style.left = i + 'px';
    document.body.appendChild(line);
  }
  
  for(let i = 0; i < window.innerHeight; i += spacing) {
    const line = document.createElement('div');
    line.className = 'grid-line horizontal';
    line.style.top = i + 'px';
    document.body.appendChild(line);
  }
}

createGridLines();

const canvas = document.getElementById('bgCanvas');
const ctx = canvas.getContext('2d');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

class Particle {
  constructor(){
    this.x = Math.random()*canvas.width;
    this.y = Math.random()*canvas.height;
    this.size = Math.random()*2+0.5;
    this.speedX = (Math.random()-0.5)*0.5;
    this.speedY = (Math.random()-0.5)*0.5;
    this.opacity = Math.random()*0.3+0.1;
  }
  update(){
    this.x += this.speedX;
    this.y += this.speedY;
    if(this.x>canvas.width) this.x=0;
    if(this.x<0) this.x=canvas.width;
    if(this.y>canvas.height) this.y=0;
    if(this.y<0) this.y=canvas.height;
  }
  draw(){
    ctx.fillStyle = `rgba(255,255,255,${this.opacity})`;
    ctx.beginPath();
    ctx.arc(this.x,this.y,this.size,0,Math.PI*2);
    ctx.fill();
  }
}

const particlesArray = [];
for(let i=0;i<100;i++){ particlesArray.push(new Particle()); }

function connectParticles() {
  for(let i=0; i<particlesArray.length; i++) {
    for(let j=i+1; j<particlesArray.length; j++) {
      const dx = particlesArray[i].x - particlesArray[j].x;
      const dy = particlesArray[i].y - particlesArray[j].y;
      const distance = Math.sqrt(dx*dx + dy*dy);
      
      if(distance < 120) {
        ctx.strokeStyle = `rgba(255,255,255,${0.05 - distance/2400})`;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(particlesArray[i].x, particlesArray[i].y);
        ctx.lineTo(particlesArray[j].x, particlesArray[j].y);
        ctx.stroke();
      }
    }
  }
}

function animate(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  particlesArray.forEach(p=>{p.update();p.draw();});
  connectParticles();
  requestAnimationFrame(animate);
}

animate();

window.addEventListener('resize', ()=>{
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  
  document.querySelectorAll('.grid-line').forEach(line => line.remove());
  createGridLines();
});