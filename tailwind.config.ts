import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/**/*.{ts,tsx}",
    "*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
  	extend: {
  		colors: {
  			background: 'var(--background)',
  			foreground: 'var(--foreground)',
  			card: {
  				DEFAULT: 'var(--card)',
  				foreground: 'var(--card-foreground)'
  			},
  			popover: {
  				DEFAULT: 'var(--popover)',
  				foreground: 'var(--popover-foreground)'
  			},
  			primary: {
  				DEFAULT: 'var(--primary)',
  				foreground: 'var(--primary-foreground)'
  			},
  			secondary: {
  				DEFAULT: 'var(--secondary)',
  				foreground: 'var(--secondary-foreground)'
  			},
  			muted: {
  				DEFAULT: 'var(--muted)',
  				foreground: 'var(--muted-foreground)'
  			},
  			accent: {
  				DEFAULT: 'var(--accent)',
  				foreground: 'var(--accent-foreground)'
  			},
  			destructive: {
  				DEFAULT: 'var(--destructive)',
  				foreground: 'var(--destructive-foreground)'
  			},
  			border: 'var(--border)',
  			input: 'var(--input)',
  			ring: 'var(--ring)',
  			chart: {
  				'1': 'var(--chart-1)',
  				'2': 'var(--chart-2)',
  				'3': 'var(--chart-3)',
  				'4': 'var(--chart-4)',
  				'5': 'var(--chart-5)'
  			},
  			neon: {
  				cyan: 'var(--neon-cyan)',
  				pink: 'var(--neon-pink)',
  				purple: 'var(--neon-purple)',
  				violet: 'var(--neon-violet)'
  			}
  		},
borderRadius: {
			lg: 'var(--radius)',
			md: 'calc(var(--radius) - 2px)',
			sm: 'calc(var(--radius) - 4px)'
		},
		fontFamily: {
			display: ['var(--font-display)', 'system-ui', 'sans-serif'],
			manga: ['var(--font-manga)', 'system-ui', 'sans-serif'],
		},
		animation: {
			'float-particle': 'floatParticle 5s ease-in-out infinite',
			'pulse-glow': 'pulseGlow 2s ease-in-out infinite',
			'slide-up': 'slideUp 0.6s ease-out',
			'slide-in-right': 'slideInRight 0.5s ease-out',
			'scale-in': 'scaleIn 0.4s ease-out',
			'shake': 'shake 0.5s ease-in-out',
			'glow-pulse': 'glowPulse 2s ease-in-out infinite',
			'float': 'float 3s ease-in-out infinite',
			'spin-slow': 'spin 8s linear infinite',
		},
		keyframes: {
			floatParticle: {
				'0%, 100%': { transform: 'translateY(0) translateX(0)', opacity: '0.5' },
				'50%': { transform: 'translateY(-20px) translateX(10px)', opacity: '1' },
			},
			pulseGlow: {
				'0%, 100%': { opacity: '0.5', transform: 'scale(1)' },
				'50%': { opacity: '1', transform: 'scale(1.05)' },
			},
			slideUp: {
				'0%': { opacity: '0', transform: 'translateY(30px)' },
				'100%': { opacity: '1', transform: 'translateY(0)' },
			},
			slideInRight: {
				'0%': { opacity: '0', transform: 'translateX(30px)' },
				'100%': { opacity: '1', transform: 'translateX(0)' },
			},
			scaleIn: {
				'0%': { opacity: '0', transform: 'scale(0.9)' },
				'100%': { opacity: '1', transform: 'scale(1)' },
			},
			shake: {
				'0%, 100%': { transform: 'translateX(0)' },
				'25%': { transform: 'translateX(-5px)' },
				'75%': { transform: 'translateX(5px)' },
			},
			glowPulse: {
				'0%, 100%': { boxShadow: '0 0 20px rgba(168, 85, 247, 0.3)' },
				'50%': { boxShadow: '0 0 40px rgba(168, 85, 247, 0.6)' },
			},
			float: {
				'0%, 100%': { transform: 'translateY(0)' },
				'50%': { transform: 'translateY(-10px)' },
			},
		},
	}
},
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
};
export default config;