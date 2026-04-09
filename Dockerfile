# Use the official Microsoft Playwright image (Python pre-installed)
FROM mcr.microsoft.com/playwright/python:v1.44.0-jammy

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE 1
ENV PYTHONUNBUFFERED 1
ENV PORT=7860
ENV HOME=/home/user
ENV PATH=/home/user/.local/bin:$PATH

# Create a non-root user (Hugging Face Requirement)
RUN useradd -m -u 1000 user

WORKDIR /app

# Install system dependencies (as root)
RUN apt-get update && apt-get install -y \
    build-essential \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install (as root for permissions)
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade -r requirements.txt

# Copy the rest of the application
COPY . .

# Fix permissions for the non-root user
RUN chown -R user:user /app
USER user

# Expose the Hugging Face port
EXPOSE 7860

# Run the app
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "7860"]
