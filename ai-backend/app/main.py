"""
DERMAI - FastAPI Main Application
AI inference API for skin condition classification
"""

import os
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import ALLOWED_ORIGINS, DEBUG, MODEL_PATH, CLASS_NAMES, validate_config
from app.services.model_loader import model_loader
from app.routers import predict as predict_router
from app.schemas.prediction import HealthResponse


# ============================================
# LIFESPAN — Load model ONCE at startup
# ============================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load model at startup, cleanup at shutdown"""
    print("=" * 70)
    print("🚀 DERMAI - Starting FastAPI AI Backend")
    print("=" * 70)
    
    # Validate config
    validate_config()
    print(f"✅ Config validated")
    print(f"   Model: {MODEL_PATH}")
    print(f"   Classes: {CLASS_NAMES}")
    
    # Load model
    model_loader.load()
    
    print("=" * 70)
    print("🚀 API ready to serve requests!")
    print("=" * 70)
    
    yield  # App runs here
    
    # Cleanup (optional)
    print("👋 Shutting down DERMAI AI Backend")


# ============================================
# APP INITIALIZATION
# ============================================

app = FastAPI(
    title="DERMAI AI API",
    description="AI inference API for skin condition classification using ResNet50",
    version="1.0.0",
    debug=DEBUG,
    lifespan=lifespan,
)

# CORS — allow frontend to call us
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================
# ROUTES
# ============================================

# Include prediction router
app.include_router(predict_router.router)


@app.get("/", tags=["Root"])
async def root():
    """Root endpoint"""
    return {
        "service": "DERMAI AI API",
        "version": "1.0.0",
        "docs": "/docs",
        "health": "/health",
        "predict": "POST /predict",
    }


@app.get("/health", response_model=HealthResponse, tags=["Health"])
async def health():
    """Health check endpoint"""
    model_loaded = model_loader._model is not None
    return HealthResponse(
        status="healthy" if model_loaded else "loading",
        model_loaded=model_loaded,
        model_path=str(MODEL_PATH),
        classes=CLASS_NAMES,
    )


# ============================================
# MAIN — For direct `python main.py` run
# ============================================

if __name__ == "__main__":
    import uvicorn
    from app.config import HOST, PORT
    
    uvicorn.run(
        "app.main:app",
        host=HOST,
        port=PORT,
        reload=DEBUG,
    )