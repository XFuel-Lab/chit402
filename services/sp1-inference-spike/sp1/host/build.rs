fn main() {
    // Compile the guest crate to a RISC-V zkVM ELF (embedded via include_elf! in main.rs).
    // Requires the SP1 toolchain (sp1up / cargo-prove); Linux/Docker/WSL/AWS only.
    sp1_build::build_program("../guest");
}
