#!/bin/bash
set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null
apt-get install -y -qq cmake ninja-build unzip wget ca-certificates python3 file >/dev/null
cd /work
if [ ! -d ndk ]; then
  echo '== NDK r27c'
  wget -q -O ndk.zip https://dl.google.com/android/repository/android-ndk-r27c-linux.zip
  unzip -q ndk.zip && mv android-ndk-r27c ndk && rm ndk.zip
fi
if [ ! -d freetype-VER-2-13-3 ]; then
  echo '== FreeType 2.13.3'
  wget -q -O ft.tar.gz https://github.com/freetype/freetype/archive/refs/tags/VER-2-13-3.tar.gz
  tar xzf ft.tar.gz && rm ft.tar.gz
fi
NDK=/work/ndk
for ABI in arm64-v8a x86_64; do
  echo "== build $ABI"
  rm -rf build-$ABI && mkdir build-$ABI && cd build-$ABI
  cmake -G Ninja ../freetype-VER-2-13-3     -DCMAKE_TOOLCHAIN_FILE=$NDK/build/cmake/android.toolchain.cmake     -DANDROID_ABI=$ABI -DANDROID_PLATFORM=android-26     -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=ON     -DFT_DISABLE_ZLIB=ON -DFT_DISABLE_BZIP2=ON -DFT_DISABLE_PNG=ON -DFT_DISABLE_HARFBUZZ=ON -DFT_DISABLE_BROTLI=ON     -DCMAKE_SHARED_LINKER_FLAGS='-Wl,-z,max-page-size=16384 -Wl,-z,common-page-size=16384'     -DCMAKE_C_FLAGS='-fPIC -O2' >/dev/null
  ninja >/dev/null
  $NDK/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-strip --strip-unneeded libfreetype.so
  mkdir -p /work/out/$ABI && cp libfreetype.so /work/out/$ABI/
  cd ..
  file out/$ABI/libfreetype.so
  $NDK/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-readelf -lW out/$ABI/libfreetype.so | grep -E 'LOAD' | head -3
  $NDK/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-readelf -dW out/$ABI/libfreetype.so | grep -E 'NEEDED|SONAME'
  ls -la out/$ABI/libfreetype.so
done
echo DONE
