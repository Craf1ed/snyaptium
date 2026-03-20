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
for(let i=0;i<150;i++){ particlesArray.push(new Particle()); }

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
});

const textData = [
    { title: "AI Chat", desc: "Engage in real-time conversations with Snyaptium, your AI companion designed to answer questions, brainstorm ideas, and provide assistance instantly." },
    { title: "Smart Tools", desc: "Access a suite of AI-powered utilities including text generation, summaries, creative writing, and analytical tools to boost productivity." },
    { title: "Explore & Learn", desc: "Discover new topics, learn new skills, and dive deep into knowledge with guidance from your AI, tailored to your personal pace and interests." },
    { title: "Community & Collaboration", desc: "Connect with other users, share insights, and collaborate on creative projects using AI-driven suggestions and smart workflows." },
    { title: "Safe & Private", desc: "Your data stays secure. Snyaptium prioritizes privacy, ensuring that your conversations and creations are protected at all times." }
];

const container = document.getElementById('textContainer');

textData.forEach((item) => {
    const div = document.createElement('div');
    div.className = 'floating-text';
    div.innerHTML = `<h3>${item.title}</h3><p>${item.desc}</p>`;
    container.appendChild(div);
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
